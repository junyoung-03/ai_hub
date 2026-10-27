// Explicit dev-only synthetic Storage -> parser -> real OCR -> Upload -> real Gemini smoke.
// Uses production service modules with a real synthetic authenticated principal adapter.
// Node Tesseract execution verifies OCR; a browser UI/cookie E2E is not claimed.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import nextEnv from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {createWorker} from 'tesseract.js';
import {load} from './helpers/calendar-loader.mjs';
import {loadAnalysisModule} from './helpers/analysis-loader.mjs';
import {isolatedInspect} from '../workers/upload/isolate.mjs';
nextEnv.loadEnvConfig(process.cwd());
const project='oclzdppdiljbojvqtkeu';
assert.equal(process.env.UPLOAD_DB_TEST_PROJECT,project);
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;assert.equal(new URL(url).hostname,project+'.supabase.co');
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}};
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin=createClient(url,secret,options);
const client=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,options);
const c=load('src/lib/uploads/contract.ts');
const result={project,upload:false,ocr:false,analysis:false,reuse:false,stale:false,cleanup:false};
let user,worker,stage='preflight';const paths=[];
try{
 const validator=loadAnalysisModule('src/lib/gemini/validation.ts');
 const gemini=loadAnalysisModule('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator});gemini.getGeminiConfig();
 stage='auth';
 const email='cpu-smoke-'+randomUUID()+'@example.invalid',password=randomBytes(36).toString('base64url');
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!created.error&&created.data.user);user=created.data.user;
 assert.ok(!(await client.auth.signInWithPassword({email,password})).error);
 const auth={requireUser:async()=>{const r=await client.auth.getUser();assert.ok(!r.error&&r.data.user?.id===user.id);return r.data.user;}};
 const server={createClient:async()=>client},adminAdapter={createAdminClient:()=>admin};
 const service=load('src/lib/uploads/service.ts',{'@/lib/uploads/contract':c,'@/lib/supabase/auth':auth,'@/lib/supabase/server':server,'@/lib/supabase/admin':adminAdapter,'@/lib/uploads/providers':{inspectFile:isolatedInspect}});
 stage='fixture';GlobalFonts.loadSystemFonts();const canvas=createCanvas(1000,300),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,300);ctx.fillStyle='black';ctx.font='48px "Malgun Gothic", sans-serif';ctx.fillText('한글 문서 테스트',40,100);ctx.fillText('ENGLISH DOCUMENT TEST 12345',40,210);
 const bytes=canvas.toBuffer('image/png'),request={fileName:'cpu-smoke.png',mimeType:'image/png',size:bytes.length};
 stage='upload';const s=await service.createUpload(request,randomUUID());paths.push(s.storagePath);
 const token=new URL(s.signedUploadUrl).searchParams.get('token');assert.ok(token);
 assert.ok(!(await client.storage.from('upload-originals').uploadToSignedUrl(s.storagePath,token,bytes,{contentType:'image/png',upsert:false})).error);
 const plan=await service.prepareUpload(s.uploadId);assert.equal(plan.state,'stored');assert.equal(plan.pages.length,1);
 result.upload=true;console.log('PASS: synthetic authenticated signed Storage upload and production prepare/parser.');
 stage='ocr';worker=await createWorker('kor+eng',1,{langPath:resolve('public/ocr/tesseract-7/lang'),cacheMethod:'none',gzip:true,logger:()=>{}});
 const recognized=await worker.recognize(bytes);await worker.terminate();worker=null;
 assert.ok(recognized.data.text.includes('한글'));assert.ok(recognized.data.text.includes('ENGLISH DOCUMENT TEST 12345'));
 result.ocr=true;console.log('PASS: actual pinned Tesseract 7 kor+eng OCR; Node driver, browser UI not claimed.');
 stage='complete';const complete=await service.completeUpload(s.uploadId,{pages:[{page:1,text:recognized.data.text,provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:recognized.data.confidence/100}]});
 assert.equal(complete.state,'complete');
 stage='stale';const started=Date.now();
 const response=await fetch(url+'/rest/v1/rpc/upload_session_rpc',{method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({p_operation:'finish',p_user_id:user.id,p_upload_id:s.uploadId,p_key:null,p_request:null,p_payload:{},p_attempt:randomUUID()}),signal:AbortSignal.timeout(10000)});
 const failure=await response.json();assert.equal(response.status,409);assert.equal(failure.code,'PT409');assert.equal(failure.message,'STALE_ATTEMPT');
 result.stale=true;result.staleElapsedMs=Date.now()-started;console.log('PASS: one stale PostgREST HTTP request returned PT409/STALE_ATTEMPT/409 promptly.');
 stage='reuse';const replay=await service.completeUpload(s.uploadId,{pages:[]});assert.equal(replay.itemId,complete.itemId);assert.equal(replay.outcome,'reused');result.reuse=true;
 stage='analysis';const analysis=loadAnalysisModule('src/lib/items/analysis.ts',{'@/lib/gemini/validation':validator,'@/lib/gemini/client':gemini,'@/lib/items/filters':{isItemId:id=>/^[0-9a-f-]{36}$/i.test(id)},'@/lib/supabase/auth':auth,'@/lib/supabase/server':server,'@/lib/supabase/admin':adminAdapter});
 await analysis.analyzeOwnedItem(complete.itemId);
 const saved=await admin.from('items').select('metadata').eq('id',complete.itemId).single();assert.ok(!saved.error&&saved.data.metadata.aiAnalysis?.result);
 const classification=await client.from('classifications').select('item_id').eq('item_id',complete.itemId);assert.ok(!classification.error&&classification.data.length===1);
 result.analysis=true;console.log('PASS: real Gemini structured analysis validated and persisted for synthetic Upload ITEM; reuse preserved identity.');
}catch(error){result.failedStage=stage;result.errorCode=/^[A-Z][A-Z0-9_]+$/.test(error.code??'')?error.code:'SMOKE_FAILED';console.error('FAIL: CPU dev smoke at '+stage+'; provider/data/credentials suppressed.');process.exitCode=1;}
finally{
 if(worker)await worker.terminate();let clean=true;
 for(const path of paths){assert.ok(user&&path.startsWith(user.id+'/'));if((await admin.storage.from('upload-originals').remove([path])).error)clean=false;}
 if(user&&(await admin.auth.admin.deleteUser(user.id)).error)clean=false;
 result.cleanup=clean;result.checkedAt=new Date().toISOString();writeFileSync('supabase/.temp/upload-cpu-smoke-result.json',JSON.stringify(result));
 if(!clean){console.error('FAIL: synthetic cleanup requires follow-up.');process.exitCode=1;}else console.log('PASS: only exact synthetic objects/user removed; existing user data untouched.');
}
