import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './calendar-loader.mjs';
import { pdfFixture,imageFixture } from './upload-fixtures.mjs';
import { isolatedInspect } from '../workers/upload/isolate.mjs';
import { deflateSync } from 'node:zlib';
const c=load('src/lib/uploads/contract.ts');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const plain=v=>JSON.parse(JSON.stringify(v));
const request=(bytes,mime='application/pdf',fileName='fixture.pdf')=>({size:bytes.length,mimeType:mime,fileName});

// Independent synthetic encoder, including zero tuples and partial final tuples.
function ascii85Encode(bytes) {
  let result='';
  for(let i=0;i<bytes.length;i+=4) {
    const block=Buffer.alloc(4);bytes.copy(block,0,i,Math.min(i+4,bytes.length));
    let value=block.readUInt32BE();const count=Math.min(4,bytes.length-i);
    if(value===0&&count===4){result+='z';continue;}
    const tuple=Array(5);for(let j=4;j>=0;j--){tuple[j]=String.fromCharCode(value%85+33);value=Math.floor(value/85);}
    result+=tuple.slice(0,count+1).join('');
  }
  return Buffer.from(result+'~>\n','ascii');
}
const compressedFixture=(dictionary,encode,pages=['text'])=>pdfFixture(pages,'',{dictionary,encode});

test('PDF Flate name/list and ASCII85 + Flate chain preserve all page text',async()=>{
  for(const [dictionary,encode] of [
    ['/Filter /FlateDecode',deflateSync],
    ['/Filter [ /FlateDecode ]',deflateSync],
    ['/Filter [ /ASCII85Decode /FlateDecode ]',bytes=>ascii85Encode(deflateSync(bytes))],
  ]) {
    const plan=await isolatedInspect(compressedFixture(dictionary,encode,['text','text']),'application/pdf');
    assert.deepEqual(plan.pages.map(p=>[p.method,p.text]),Array(2).fill(['embedded','Synthetic fixture text']));
  }
});

test('compressed object dictionaries still reject active names and oversized images',async()=>{
  for(const ascii85 of [false,true]) {
    const dictionary=`/Type /ObjStm /N 1 /First 4 /Filter ${ascii85?'[ /ASCII85Decode /FlateDecode ]':'[ /FlateDecode ]'}`;
    for(const name of ['JavaScript','J#53','Launch','EmbeddedFile','Filespec','AA','OpenAction','XFA','RichMedia','SubmitForm','GoToR','Prev','Encrypt']) {
      const encode=()=>{const bytes=deflateSync(Buffer.from(`9 0 << /${name} null >>`));return ascii85?ascii85Encode(bytes):bytes;};
      await assert.rejects(isolatedInspect(compressedFixture(dictionary,encode),'application/pdf'),{message:name==='Encrypt'?'PDF_ENCRYPTED':'PDF_UNSAFE'});
    }
    const encode=()=>{const bytes=deflateSync(Buffer.from('9 0 << /Subtype /Image /Width 10001 /Height 1 >>'));return ascii85?ascii85Encode(bytes):bytes;};
    await assert.rejects(isolatedInspect(compressedFixture(dictionary,encode),'application/pdf'),{message:'FILE_LIMIT'});
  }
});

test('data-stream bytes that resemble active names do not define PDF actions',async()=>{
  for(const filter of ['/FlateDecode','[ /FlateDecode ]','[ /ASCII85Decode /FlateDecode ]']) {
    const encode=bytes=>{const zipped=deflateSync(Buffer.concat([bytes,Buffer.from('\n% /AA /JS harmless data\n')]));return filter.includes('ASCII85')?ascii85Encode(zipped):zipped;};
    const plan=await isolatedInspect(compressedFixture(`/Filter ${filter}`,encode),'application/pdf');
    assert.equal(plan.pages[0].text,'Synthetic fixture text');
  }
});

test('unsupported Flate chains, malformed ASCII85 and invalid zlib stay rejected',async()=>{
  for(const filter of ['[ /FlateDecode /ASCII85Decode ]','[ /ASCIIHexDecode /FlateDecode ]','[ /ASCII85Decode /FlateDecode /FlateDecode ]','[ /FlateDecode null ]']) {
    await assert.rejects(isolatedInspect(compressedFixture(`/Filter ${filter}`,deflateSync),'application/pdf'),{message:'PDF_LAYOUT_NEEDS_REVIEW'});
  }
  for(const payload of ['!!!!!','!~>','!!z~>','uuuuu~>','v~>','!!!!!~>x','!!!!!~x','z~>']) {
    await assert.rejects(isolatedInspect(compressedFixture('/Filter [ /ASCII85Decode /FlateDecode ]',()=>Buffer.from(payload)),'application/pdf'),{message:'INVALID_FILE'});
  }
});

test('Flate output and ASCII85 intermediate outputs share the aggregate expansion budget',async()=>{
  // 33 MB per stream: neither stream alone exceeds 64 MB, their sum does.
  const zipped=deflateSync(Buffer.alloc(33_000_000,32));
  for(const ascii85 of [false,true]) {
    const dictionary=`/Filter ${ascii85?'[ /ASCII85Decode /FlateDecode ]':'[ /FlateDecode ]'}`;
    await assert.rejects(isolatedInspect(compressedFixture(dictionary,()=>ascii85?ascii85Encode(zipped):zipped,['text','text']),'application/pdf'),{message:'FILE_LIMIT'});
  }
});
test('upload request allows exactly one declared file; rejects spoof, path, owner, status, hash and limits',()=>{
  assert.equal(c.parseUploadRequest(request(Buffer.from('x'))).fileName,'fixture.pdf');
  for(const changes of [{fileName:'../x.pdf'},{fileName:'a\\b.pdf'},{fileName:'a.exe'},{fileName:'a.png'},{size:5000001},{size:0},{userId:other},{storagePath:'x'},{processing_status:'completed'},{hash:'x'}])assert.throws(()=>c.parseUploadRequest({...request(Buffer.from('x')),...changes}),c.UploadError);
  assert.equal(c.uploadPath(owner,id,'image/jpeg'),`${owner}/${id}/original.jpg`);
  assert.throws(()=>c.uploadPath('../x',id,'image/png'));
  assert.throws(()=>c.verifyBytes(Buffer.from('MZexe'),request(Buffer.from('MZexe'))));
});
test('actual isolated PDF text, scanned and mixed page parsing with mock OCR and code point map',async()=>{
  for(const kinds of [['text'],['scan'],['text','scan'],['ambiguous']]){
    const plan=await isolatedInspect(pdfFixture(kinds),'application/pdf');
    assert.deepEqual(plan.pages.map(p=>p.method),kinds.map(k=>k==='scan'?'ocr':'embedded'));
    const result=c.assemble(plan.pages.map(p=>({text:p.text??'Mock OCR 한글 😀',method:p.method,confidence:p.method==='ocr'?0.01:null})));
    assert.equal(result.pages.at(-1).end,Array.from(result.text).length);
    assert.equal(result.hash,c.sha256(result.text));
    for(const page of result.pages)assert.equal(Array.from(result.text).slice(page.start,page.end).join(''),page.method==='ocr'?'Mock OCR 한글 😀':'Synthetic fixture text');
    assert.equal(result.pages.find(p=>p.method==='ocr')?.confidence??null,kinds.includes('scan')?0.01:null);
  }
});
test('PNG and JPEG full decoders return one image page; OCR fixture is whole text',async()=>{
  for(const [format,mime] of [['png','image/png'],['jpeg','image/jpeg']]){
    const bytes=await imageFixture(format),plan=await isolatedInspect(bytes,mime);
    assert.equal(plan.pages.length,1);assert.equal(plan.pages[0].method,'ocr');
    assert.equal(plan.rawHash,c.verifyBytes(bytes,request(bytes,mime,`x.${format}`)));
    const r=c.assemble([{text:'한글 😀',method:'ocr',confidence:null}]);assert.equal(r.pages[0].start,0);assert.equal(r.pages[0].end,4);
  }
});
test('parser blocks oversized, encrypted, corrupt, script, launch, embedded file and ambiguous PDFs',async()=>{
  const cases=[ [Buffer.alloc(5000001),'image/png','FILE_LIMIT'],[pdfFixture(Array(11).fill('text')),'application/pdf','FILE_LIMIT'],
    [pdfFixture(['text'],'/Encrypt 4 0 R'),'application/pdf','PDF_ENCRYPTED'],[Buffer.from('%PDF-1.7 broken'),'application/pdf','INVALID_FILE'],
    [Buffer.from([137,80,78,71,13,10,26,10,0]),'image/png','INVALID_FILE'] ];
  for(const name of ['JavaScript','Launch','EmbeddedFile','J#53','GoToR'])cases.push([pdfFixture(['text'],`/${name} null`),'application/pdf','PDF_UNSAFE']);
  for(const [bytes,mime,code] of cases)await assert.rejects(isolatedInspect(bytes,mime),{message:code});
  const large=await imageFixture('png',10001,1);await assert.rejects(isolatedInspect(large,'image/png'),{message:'FILE_LIMIT'});
  const pixels=await imageFixture('png',5000,4001);await assert.rejects(isolatedInspect(pixels,'image/png'),{message:'FILE_LIMIT'});
  await assert.rejects(isolatedInspect(pdfFixture().subarray(0,-20),'application/pdf'),{message:'INVALID_FILE'});
});
test('image parser verifies valid PNG/JPEG, dimensions, and rejects spoofing/truncation/APNG',async()=>{
  const validPng=await imageFixture('png',16,12);
  const validJpg=await imageFixture('jpeg',16,12);
  const pngPlan=await isolatedInspect(validPng,'image/png');
  assert.equal(pngPlan.pages.length,1);assert.equal(pngPlan.pages[0].method,'ocr');
  const jpgPlan=await isolatedInspect(validJpg,'image/jpeg');
  assert.equal(jpgPlan.pages.length,1);assert.equal(jpgPlan.pages[0].method,'ocr');

  // MIME spoofing
  await assert.rejects(isolatedInspect(validPng,'image/jpeg'),{message:'UNSUPPORTED_FILE'});
  await assert.rejects(isolatedInspect(validPng,'application/pdf'),{message:'UNSUPPORTED_FILE'});
  await assert.rejects(isolatedInspect(validJpg,'image/png'),{message:'UNSUPPORTED_FILE'});

  // 10,001px and >20MP
  const wide=await imageFixture('png',10001,1);
  await assert.rejects(isolatedInspect(wide,'image/png'),{message:'FILE_LIMIT'});
  const tall=await imageFixture('png',1,10001);
  await assert.rejects(isolatedInspect(tall,'image/png'),{message:'FILE_LIMIT'});
  const largePixels=await imageFixture('png',5000,4001);
  await assert.rejects(isolatedInspect(largePixels,'image/png'),{message:'FILE_LIMIT'});

  // Truncated PNG
  await assert.rejects(isolatedInspect(validPng.subarray(0,30),'image/png'),{message:'INVALID_FILE'});
  await assert.rejects(isolatedInspect(validPng.subarray(0,validPng.length-8),'image/png'),{message:'INVALID_FILE'});

  // Truncated JPEG
  await assert.rejects(isolatedInspect(validJpg.subarray(0,4),'image/jpeg'),{message:'INVALID_FILE'});
  await assert.rejects(isolatedInspect(validJpg.subarray(0,30),'image/jpeg'),{message:'INVALID_FILE'});

  // APNG (acTL chunk before IEND)
  const apng=Buffer.concat([validPng.subarray(0,validPng.length-12),Buffer.from([0,0,0,8,0x61,0x63,0x54,0x4C,0,0,0,1,0,0,0,1,0,0,0,0]),validPng.subarray(validPng.length-12)]);
  await assert.rejects(isolatedInspect(apng,'image/png'),{message:'UNSUPPORTED_FILE'});
});
test('Vercel runtime executes in-process without fork for PNG/JPEG/PDF, while non-Vercel retains fork',async()=>{
  const validPng=await imageFixture('png',16,12);
  const validJpg=await imageFixture('jpeg',16,12);
  const origVercel=process.env.VERCEL;
  try {
    // 1. Vercel env flag + PNG -> fork is NOT called
    process.env.VERCEL = '1';
    let forkCallsPng = 0;
    const planPng = await isolatedInspect(validPng, 'image/png', { _fork: () => { forkCallsPng++; } });
    assert.equal(forkCallsPng, 0, 'fork must not be called for PNG in Vercel runtime');
    assert.equal(planPng.pages[0].method, 'ocr');

    // 2. Vercel env flag + JPEG -> fork is NOT called
    let forkCallsJpg = 0;
    const planJpg = await isolatedInspect(validJpg, 'image/jpeg', { _fork: () => { forkCallsJpg++; } });
    assert.equal(forkCallsJpg, 0, 'fork must not be called for JPEG in Vercel runtime');
    assert.equal(planJpg.pages[0].method, 'ocr');

    // 3. Vercel env flag + PDF -> fork is NOT called
    let forkCallsPdf = 0;
    const planPdf = await isolatedInspect(pdfFixture(['text','scan']), 'application/pdf', { _fork: () => { forkCallsPdf++; } });
    assert.equal(forkCallsPdf, 0, 'fork must not be called for PDF in Vercel runtime');
    assert.equal(planPdf.pages[0].method, 'embedded');
    assert.equal(planPdf.pages[1].method, 'ocr');

    // 4. Corrupt image/pdf rejection in Vercel in-process mode
    await assert.rejects(isolatedInspect(Buffer.from([137,80,78,71,13,10,26,10,0,0]), 'image/png'), { message: 'INVALID_FILE' });
    await assert.rejects(isolatedInspect(Buffer.from([255,216,255,0,0]), 'image/jpeg'), { message: 'INVALID_FILE' });
    await assert.rejects(isolatedInspect(Buffer.from('%PDF-1.7 corrupt'), 'application/pdf'), { message: 'INVALID_FILE' });

    // 5. Non-Vercel + PNG -> existing fork retained
    delete process.env.VERCEL;
    let forkCallsNonVercel = 0;
    const { fork } = await import('node:child_process');
    const planLocal = await isolatedInspect(validPng, 'image/png', {
      _fork: (...args) => {
        forkCallsNonVercel++;
        return fork(...args);
      }
    });
    assert.equal(forkCallsNonVercel, 1, 'fork must be called for PNG in non-Vercel runtime');
    assert.equal(planLocal.pages[0].method, 'ocr');

    // 6. Non-Vercel + PDF -> existing fork retained
    let forkCallsNonVercelPdf = 0;
    const planLocalPdf = await isolatedInspect(pdfFixture(['text','scan']), 'application/pdf', {
      _fork: (...args) => {
        forkCallsNonVercelPdf++;
        return fork(...args);
      }
    });
    assert.equal(forkCallsNonVercelPdf, 1, 'fork must be called for PDF in non-Vercel runtime');
    assert.equal(planLocalPdf.pages[0].method, 'embedded');
    assert.equal(planLocalPdf.pages[1].method, 'ocr');
  } finally {
    if (origVercel !== undefined) process.env.VERCEL = origVercel;
    else delete process.env.VERCEL;
  }
});
test('text never truncates; empty OCR fails; safe Detail excludes raw hash, filename, credential and provider response',()=>{
  assert.throws(()=>c.assemble([{text:'x'.repeat(100001),method:'ocr',confidence:null}]),{code:'TEXT_LIMIT'});
  assert.throws(()=>c.assemble([{text:'',method:'ocr',confidence:null}]),{code:'EMPTY_TEXT'});
  const result=c.assemble([{text:'safe',method:'ocr',confidence:0.01}]);
  const detail=c.uploadDetail({secret:'CANARY',upload:{rawHash:'CANARY',filename:'CANARY',extraction:{...result,credential:'CANARY',rawResponse:'CANARY'}}});
  assert.equal(detail.pages[0].confidence,0.01);assert.ok(!JSON.stringify(detail).includes('CANARY'));assert.ok(!JSON.stringify(detail).includes('"text"'));
  assert.deepEqual(Object.keys(plain(detail)).sort(),['error','extractionStatus','pages','version']);
});
test('Vision adapter is disabled by default and only mock DOCUMENT_TEXT_DETECTION response is consumed',async()=>{
  let calls=0,payload;
  class GoogleAuth {async getClient(){return {async getRequestHeaders(){return new Headers({authorization:'Bearer CANARY'});}};}}
  const globals={process:{env:{UPLOAD_OCR_ENABLED:'true',GOOGLE_CLOUD_PROJECT:'fixture-project'}},fetch:async(url,init)=>{calls++;assert.equal(url,'https://vision.googleapis.com/v1/images:annotate');payload=JSON.parse(init.body);return Response.json({responses:[{fullTextAnnotation:{text:'Keep low confidence',pages:[{confidence:0.01}]},secret:'CANARY'}]});}};
  const imports={'google-auth-library':{GoogleAuth},'@/lib/uploads/contract':c};
  const off=load('src/lib/uploads/managed-providers.ts',imports,{process:{env:{}}});await assert.rejects(off.ocrImage('fixture',AbortSignal.timeout(1000)),{code:'OCR_UNAVAILABLE'});assert.equal(calls,0);
  const on=load('src/lib/uploads/managed-providers.ts',imports,globals),r=await on.ocrImage('fixture',AbortSignal.timeout(1000));
  assert.equal(payload.requests[0].features[0].type,'DOCUMENT_TEXT_DETECTION');assert.equal(r.text,'Keep low confidence');assert.equal(r.confidence,0.01);assert.ok(!JSON.stringify(r).includes('CANARY'));
});
function serviceHarness({bytes=pdfFixture(),state='pending',itemId=null,downloadError=false,finishError=false,finishCode='PT409',finishMessage='STALE_ATTEMPT',finishStorageError=false,path,foreign=false,embedded=false,expired=false,missingOwner=false,emptyEmbedded=false}={}){
  const calls=[];let attempt=null;
  const req=request(bytes);const storage={async download(){calls.push('download');return {data:new Blob([bytes]),error:downloadError?{}:null};},async createSignedUrl(p,seconds){calls.push(['signed',p,seconds]);return {data:{signedUrl:'https://private.invalid/mock'},error:null};},async createSignedUploadUrl(){calls.push('issue-url');return {data:{signedUrl:'https://private.invalid/mock-upload'},error:null};}};
  const admin={storage:{from(bucket){assert.equal(bucket,'upload-originals');return storage;}},async rpc(name,args){assert.equal(name,'upload_session_rpc');calls.push(args.p_operation);if(args.p_operation==='read'&&missingOwner)return {error:{code:'22023'}};if(args.p_operation==='finish'&&finishError)return {error:{code:finishCode,message:finishMessage}};if(args.p_operation==='finish'&&finishStorageError)return {error:{code:'XX000'}};
    if(args.p_operation==='pending'){state='stored';itemId=id;}if(args.p_operation==='claim'){state='running';attempt=id;}if(args.p_operation==='fail')state='failed';if(args.p_operation==='finish')state='complete';
    if(args.p_operation==='reserve')attempt=id;if(args.p_operation==='release')attempt=null;
    return {data:{id,state,request:req,path:path??c.uploadPath(owner,id,'application/pdf'),itemId,attempt,rawHash:null,expiresAt:new Date(Date.now()+(expired?-60000:60000)).toISOString()},error:null};}};
  const builder={select(){return this;},eq(){return this;},abortSignal(){return this;},async maybeSingle(){return {data:foreign?null:{id,source:'upload',format:'pdf',processing_status:'queued',external_id:id,storage_path:path??c.uploadPath(owner,id,'application/pdf'),mime_type:'application/pdf',metadata:{upload:{validated:true}}},error:null};}};
  const client={from(){return builder;},storage:admin.storage};
  const service=load('src/lib/uploads/service.ts',{'@/lib/uploads/contract':c,'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/server':{createClient:async()=>client},'@/lib/supabase/admin':{createAdminClient:()=>admin},'@/lib/uploads/providers':{inspectFile:async()=>({rawHash:c.sha256(bytes),pages:[embedded?{page:1,method:'embedded',text:emptyEmbedded?'':'Server PDF text'}:{page:1,method:'ocr'}]})}});
  return {service,calls,getState:()=>state};
}
test('complete creates pending then claims and atomically finishes; Storage failure can retry; reused has no download',async()=>{
  const h=serviceHarness();assert.equal((await h.service.completeUpload(id,{pages:[{page:1,text:'fixture',provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:null}]})).state,'complete');assert.deepEqual(h.calls,['read','reserve','download','pending','claim','finish']);
  const fail=serviceHarness({downloadError:true});await assert.rejects(fail.service.completeUpload(id),{code:'STORAGE_UNAVAILABLE'});assert.equal(fail.getState(),'pending');assert.ok(!fail.calls.includes('pending'));
  const reused=serviceHarness({state:'complete',itemId:id});assert.equal((await reused.service.completeUpload(id)).outcome,'reused');assert.deepEqual(reused.calls,['read']);
});
test('extraction failure writes failed with no partial text; stale completion cannot overwrite current attempt',async()=>{
  const fail=serviceHarness();await assert.rejects(fail.service.completeUpload(id),{code:'VALIDATION_ERROR'});assert.ok(!fail.calls.includes('claim'));assert.ok(!fail.calls.includes('finish'));assert.equal(fail.calls.at(-1),'release');
  const stale=serviceHarness({finishError:true});await assert.rejects(stale.service.completeUpload(id,{pages:[{page:1,text:'fixture',provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:null}]}),{code:'STALE_ATTEMPT'});assert.ok(!stale.calls.includes('fail'));
  const empty=serviceHarness({embedded:true,emptyEmbedded:true});await assert.rejects(empty.service.prepareUpload(id),{code:'EMPTY_TEXT'});assert.equal(empty.getState(),'failed');assert.ok(!empty.calls.includes('finish'));
  const unavailable=serviceHarness({embedded:true,finishStorageError:true});await assert.rejects(unavailable.service.prepareUpload(id),{code:'STORAGE_UNAVAILABLE'});assert.equal(unavailable.getState(),'failed');assert.equal(unavailable.calls.at(-1),'fail');
});
test('signed original requires owner and canonical validated path, exactly 60s',async()=>{
  const owned=serviceHarness();assert.ok((await owned.service.uploadOriginal(id)).downloadUrl);assert.deepEqual(owned.calls,[['signed',c.uploadPath(owner,id,'application/pdf'),60]]);
  for(const changes of [{foreign:true},{path:`${other}/${id}/original.pdf`},{path:`${owner}/../original.pdf`}]){const h=serviceHarness(changes);await assert.rejects(h.service.uploadOriginal(id));assert.equal(h.calls.length,0);}
});
test('prepare releases the DB lease before browser OCR; reconnect prepares same stored session; text PDF finishes without client text',async()=>{
  const h=serviceHarness();const plan=await h.service.prepareUpload(id);assert.equal(plan.state,'stored');assert.deepEqual(plain(plan.pages),[{page:1,method:'ocr'}]);assert.deepEqual(h.calls.slice(0,6),['read','reserve','download','pending','release',['signed',c.uploadPath(owner,id,'application/pdf'),60]]);assert.ok(!h.calls.includes('claim'));
  await h.service.prepareUpload(id);assert.equal(h.calls.filter(v=>v==='release').length,2);
  const text=serviceHarness({embedded:true});assert.equal((await text.service.prepareUpload(id)).state,'complete');assert.ok(text.calls.includes('finish'));
});
test('foreign and expired pending sessions stop before Storage; client control characters and missing pages cannot claim',async()=>{
  for(const [options,code]of [[{missingOwner:true},'ITEM_NOT_FOUND'],[{expired:true},'UPLOAD_EXPIRED']]){const h=serviceHarness(options);await assert.rejects(h.service.prepareUpload(id),{code});assert.ok(!h.calls.includes('download'));}
  const h=serviceHarness();await assert.rejects(h.service.completeUpload(id,{pages:[]}),{code:'VALIDATION_ERROR'});assert.equal(h.calls.at(-1),'release');assert.ok(!h.calls.includes('claim'));
});
test('isolated child has a kill deadline and no actual provider call',async()=>{
  await assert.rejects(isolatedInspect(pdfFixture(),'application/pdf',{timeout:1}),{message:'PROCESSING_TIMEOUT'});
});
test('upload HTTP contracts enforce origin/body bounds, reject fields and return safe 401/409/500 no-store errors',async()=>{
  class AuthenticationRequiredError extends Error {}
  let invoked=0;
  const service={uploadErrorStatus:code=>code==='FORBIDDEN'?403:code==='IDEMPOTENCY_CONFLICT'?409:422,
    createUpload:async(value,key)=>{invoked++;c.parseUploadRequest(value);assert.equal(key,id);return {uploadId:id};},completeUpload:async()=>{invoked++;return {itemId:id};}};
  const http=load('src/lib/uploads/http.ts',{'@/lib/supabase/auth':{AuthenticationRequiredError},'@/lib/uploads/contract':c,'@/lib/uploads/service':service});
  const dependencies={'@/lib/uploads/contract':c,'@/lib/uploads/http':http,'@/lib/uploads/service':service};
  const route=load('src/app/api/v1/uploads/route.ts',dependencies),complete=load('src/app/api/v1/uploads/[uploadId]/complete/route.ts',dependencies);
  const req=(body,origin='http://localhost')=>new Request('http://localhost/api/v1/uploads',{method:'POST',headers:{origin,'idempotency-key':id},body});
  assert.equal((await route.POST(req(JSON.stringify(request(Buffer.from('x')))))).status,201);
  assert.equal((await route.POST(req('{}','http://foreign.invalid'))).status,403);
  assert.equal((await route.POST(req('x'.repeat(1025)))).status,422);
  assert.equal((await complete.POST(req('{"storagePath":"unsafe"}'),{params:Promise.resolve({uploadId:id})})).status,422);assert.equal(invoked,1);
  assert.equal((await complete.POST(req('x'.repeat(2_500_001)),{params:Promise.resolve({uploadId:id})})).status,422);assert.equal(invoked,1);
  for(const [error,status] of [[new AuthenticationRequiredError(),401],[new c.UploadError('IDEMPOTENCY_CONFLICT'),409],[new Error('CANARY-private-response'),500]]){
    const response=http.uploadFailure(error);assert.equal(response.status,status);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.ok(!JSON.stringify(await response.json()).includes('CANARY'));
  }
});

// The RPC returns PT409 once; the API preserves its existing domain error and HTTP status.
test('PT409 stale attempt fails once without fail/retry; legacy 40001 remains compatible',async()=>{
  for(const finishCode of ['PT409','40001']){
    const h=serviceHarness({finishError:true,finishCode});
    await assert.rejects(h.service.completeUpload(id,{pages:[{page:1,text:'fixture',provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:null}]}),{code:'STALE_ATTEMPT'});
    assert.equal(h.calls.filter(v=>v==='finish').length,1);
    assert.ok(!h.calls.includes('fail'));
    assert.equal(h.service.uploadErrorStatus('STALE_ATTEMPT'),409);
  }
  const unknown=serviceHarness({finishError:true,finishMessage:'OTHER_CONFLICT'});
  await assert.rejects(unknown.service.completeUpload(id,{pages:[{page:1,text:'fixture',provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:null}]}),{code:'STORAGE_UNAVAILABLE'});
});

test('Upload complete HTTP route maps PT409 STALE_ATTEMPT to 409 without storage-unavailable fallback',async()=>{
  const h=serviceHarness({finishError:true});
  class AuthenticationRequiredError extends Error {}
  const http=load('src/lib/uploads/http.ts',{'@/lib/supabase/auth':{AuthenticationRequiredError},'@/lib/uploads/contract':c,'@/lib/uploads/service':h.service});
  const route=load('src/app/api/v1/uploads/[uploadId]/complete/route.ts',{'@/lib/uploads/contract':c,'@/lib/uploads/http':http,'@/lib/uploads/service':h.service});
  const input={pages:[{page:1,text:'fixture',provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:null}]};
  const response=await route.POST(new Request('http://localhost/api/v1/uploads/'+id+'/complete',{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(input)}),{params:Promise.resolve({uploadId:id})});
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,'STALE_ATTEMPT');
  assert.equal(h.calls.filter(v=>v==='finish').length,1);assert.ok(!h.calls.includes('fail'));
});
