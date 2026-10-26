// Browser adapter/flow fixtures only. No real OCR, credentials or remote writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './calendar-loader.mjs';
import {isolatedInspect} from '../workers/upload/isolate.mjs';
import {pdfFixture} from './upload-fixtures.mjs';
const c=load('src/lib/uploads/contract.ts');
const page=(number=1,text='한글 English 😀')=>({page:number,text,provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:0.01});

test('upload failures have actionable messages without exposing arbitrary error content',()=>{
  const {uploadErrorMessage}=load('src/lib/uploads/browser/error-message.ts');
  assert.match(uploadErrorMessage('PDF_LAYOUT_NEEDS_REVIEW'),/압축·구조/);
  assert.match(uploadErrorMessage('PDF_ENCRYPTED'),/암호화/);
  assert.match(uploadErrorMessage('FILE_LIMIT'),/5MB/);
  assert.match(uploadErrorMessage('WORKER_UNAVAILABLE'),/재시도/);
  assert.match(uploadErrorMessage('UPLOAD_CANCELLED'),/취소/);
  assert.equal(uploadErrorMessage('private upstream payload'),uploadErrorMessage());
  assert.equal(uploadErrorMessage('__proto__'),uploadErrorMessage());
});

test('prepare failure preserves the server error code and never invokes OCR',async()=>{
  const flow=load('src/lib/uploads/browser/flow.ts',{}, {fetch:async()=>Response.json({error:{code:'PDF_LAYOUT_NEEDS_REVIEW'}},{status:422})});
  let ocrCalls=0;
  await assert.rejects(flow.runUpload({checkpoint:{uploadId:'fixture',idempotencyKey:'fixture-key'},signal:new AbortController().signal,onCheckpoint:()=>{},onPhase:()=>{},onProgress:()=>{},providerFactory:async()=>{ocrCalls++;throw new Error('unexpected OCR');}}),{message:'PDF_LAYOUT_NEEDS_REVIEW'});
  assert.equal(ocrCalls,0);
});
test('client input rejects missing/duplicate/additional pages and forged ownership/hash/range/provider/execution/version',()=>{
  const plan={mime:'application/pdf',pages:[{page:1,method:'embedded',text:'Server text'},{page:2,method:'ocr'}]};
  const valid=c.parseCompleteInput({pages:[page(2)]});
  const extraction=c.assemble(c.mergeClientPages(plan,valid));assert.equal(extraction.pages[0].execution,'server');assert.equal(extraction.pages[1].execution,'client');assert.equal(extraction.method,'mixed');assert.equal(extraction.pages[1].start,13);assert.equal(extraction.pages[1].end,Array.from(extraction.text).length);
  for(const pages of [[],[page(1)],[page(2),page(3)]])assert.throws(()=>c.mergeClientPages(plan,c.parseCompleteInput({pages})));
  for(const delta of [{provider:'gemini'},{execution:'server'},{providerVersion:'999'},{language:'eng'},{text:''},{text:'\u0000bad'},{text:'\ufffd'},{text:'\ud800'},{confidence:NaN},{confidence:2},{start:0},{end:5},{hash:'fake'},{storagePath:'fake'},{userId:'other'},{itemId:'fake'},{processing_status:'complete'}])assert.throws(()=>c.parseCompleteInput({pages:[{...page(),...delta}]}));
  assert.throws(()=>c.parseCompleteInput({pages:[page(),page()]}));assert.throws(()=>c.parseCompleteInput({pages:[page(1,'x'.repeat(100001))]}),{code:'TEXT_LIMIT'});
  assert.throws(()=>c.parseCompleteInput({pages:[],content_hash:'fake'}));assert.equal(c.parseCompleteInput({pages:[page(1,'e\u0301')]}).pages[0].text,'é');
});
function providerHarness({hang=false,fail=false}={}){
  const calls=[];let terminated=0,workers=0;
  class FakeWorker{
    postMessage(packet){calls.push(packet);if(hang)return;queueMicrotask(()=>this.onmessage({data:{jobId:packet.jobId,status:fail?'reject':'resolve',data:packet.action==='recognize'?{text:'한글 English',confidence:1,raw:'SECRET'}:{}}}));}
    terminate(){terminated++;}
  }
  const {BrowserTesseractProvider}=load('src/lib/uploads/browser/tesseract-provider.ts',{}, {location:{origin:'https://synthetic.invalid'},queueMicrotask,Blob});
  const provider=new BrowserTesseractProvider(path=>{assert.equal(path,'/ocr/tesseract-7/worker.min.js');workers++;return new FakeWorker();});
  return {provider,calls,counts:()=>({terminated,workers})};
}
test('one pinned Tesseract Web Worker initializes kor+eng/cache, handles sequential images and strips raw output',async()=>{
  const h=providerHarness(),signal=new AbortController().signal;await h.provider.initialize(signal,()=>{});
  const first=await h.provider.recognize(1,new Blob(['validated image']),signal),second=await h.provider.recognize(2,new Blob(['validated image']),signal);
  assert.equal(first.confidence,0.01);assert.equal(second.page,2);assert.ok(!JSON.stringify(first).includes('SECRET'));
  assert.deepEqual(h.calls.map(c=>c.action),['load','loadLanguage','initialize','recognize','recognize']);assert.equal(h.calls[1].payload.langs,'kor+eng');assert.equal(h.calls[1].payload.options.cacheMethod,'write');h.provider.dispose();h.provider.dispose();assert.deepEqual(h.counts(),{workers:1,terminated:1});
});
test('cancel during WASM/language startup and engine error terminate worker without late text',async()=>{
  const h=providerHarness({hang:true}),abort=new AbortController();const initializing=h.provider.initialize(abort.signal,()=>{});abort.abort();await assert.rejects(initializing);assert.equal(h.counts().terminated,1);
  const failed=providerHarness({fail:true});await assert.rejects(failed.provider.initialize(new AbortController().signal,()=>{}));assert.equal(failed.counts().terminated,1);
});
test('server plan performs embedded extraction and scan detection without server raster payloads',async()=>{
  const plan=await isolatedInspect(pdfFixture(['text','scan']),'application/pdf',{render:false});assert.deepEqual(plan.pages.map(p=>p.method),['embedded','ocr']);assert.equal(plan.pages[0].text,'Synthetic fixture text');assert.equal(plan.pages[1].image,undefined);
});
function flowHarness(prepared,{cancel=false}={}){
  const calls=[],phases=[];let init=0,disposed=0,ocr=0;const abort=new AbortController();
  const provider={async initialize(){init++;},async recognize(n){ocr++;if(cancel){abort.abort();throw new Error('cancelled');}return page(n);},dispose(){disposed++;}};
  const mockFetch=async(url,options)=>{calls.push({url,body:options?.body});if(url.endsWith('/prepare'))return Response.json(prepared);if(url.endsWith('/complete'))return Response.json({itemId:'fixture',state:'complete',outcome:'created'});return new Response(new Blob(['synthetic image']));};
  const flow=load('src/lib/uploads/browser/flow.ts',{'./render':{async *renderOCRPages(){yield {page:2,image:new Blob(['synthetic'])};}}},{fetch:mockFetch,Blob});
  return {run:()=>flow.runUpload({checkpoint:{uploadId:'fixture',idempotencyKey:'fixture-key'},signal:abort.signal,onCheckpoint:()=>{},onPhase:v=>phases.push(v),onProgress:()=>{},providerFactory:async()=>provider}),calls,phases,counts:()=>({init,disposed,ocr})};
}
test('text-PDF/reused completion never loads OCR; resumed OCR sends text-only and disposes before save',async()=>{
  const text=flowHarness({itemId:'fixture',state:'complete',outcome:'created'});await text.run();assert.deepEqual(text.counts(),{init:0,disposed:0,ocr:0});
  const image=flowHarness({state:'stored',pages:[{page:1,method:'embedded'},{page:2,method:'ocr'}],mime:'application/pdf',downloadUrl:'https://synthetic.invalid/original'});await image.run();assert.deepEqual(image.counts(),{init:1,disposed:1,ocr:1});const body=JSON.parse(image.calls.at(-1).body);assert.equal(body.pages[0].page,2);assert.ok(!JSON.stringify(body).includes('image'));assert.deepEqual(image.phases,['preparing','ocr','saving','complete']);
});
test('cancel/tab-close equivalent cannot save partial pages; original session can be resumed',async()=>{
  const prepared={state:'stored',mime:'image/png',downloadUrl:'https://synthetic.invalid/original'};const h=flowHarness(prepared,{cancel:true});await assert.rejects(h.run());assert.equal(h.counts().disposed,1);assert.ok(!h.calls.some(c=>c.url.endsWith('/complete')));const retry=flowHarness(prepared);await retry.run();assert.equal(retry.counts().ocr,1);
});
