// Explicit opt-in: one synthetic image through the deployed Production HTTP APIs.
// Real Supabase SSR session cookies; no authentication or server-route adapter bypass.
// OCR uses pinned local Tesseract; browser UI/Worker execution is not claimed.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import nextEnv from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {createWorker} from 'tesseract.js';
nextEnv.loadEnvConfig(process.cwd());
assert.equal(process.env.UPLOAD_PRODUCTION_SMOKE,'YES');
const origin='https://ai-hub-one-ebon.vercel.app',project='oclzdppdiljbojvqtkeu';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;assert.equal(new URL(url).hostname,project+'.supabase.co');
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}};
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const jar=new Map();
const client=createServerClient(url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cookies=>{for(const cookie of cookies)jar.set(cookie.name,cookie.value);}}});
const result={origin,startedAt:new Date().toISOString(),upload:false,ocr:false,complete:false,reuse:false,gemini:false,item:false,cleanup:false,requests:[]};
const paths=[];let user,worker,stage='auth';
async function api(path,body,expected=200,headers={}){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json',Cookie:[...jar].map(([name,value])=>name+'='+value).join('; '),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
 result.requests.push({path,status:response.status,requestId:response.headers.get('x-vercel-id')});
 const data=await response.json();if(response.status!==expected){result.failureCode=data.error?.code??'UNEXPECTED_HTTP_STATUS';throw new Error('Unexpected HTTP status');}return data;
}
try{
 const email='cpu-production-smoke-'+randomUUID()+'@example.invalid',password=randomBytes(36).toString('base64url');
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!created.error&&created.data.user);user=created.data.user;
 assert.ok(!(await client.auth.signInWithPassword({email,password})).error);assert.ok(jar.size);
 stage='fixture';GlobalFonts.loadSystemFonts();const canvas=createCanvas(1000,300),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,300);ctx.fillStyle='black';ctx.font='48px "Malgun Gothic", sans-serif';ctx.fillText('한글 문서 테스트',40,100);ctx.fillText('ENGLISH DOCUMENT TEST 12345',40,210);const bytes=canvas.toBuffer('image/png');
 stage='upload';const session=await api('/api/v1/uploads',{fileName:'production-cpu-smoke.png',mimeType:'image/png',size:bytes.length},201,{'idempotency-key':randomUUID()});paths.push(session.storagePath);
 const token=new URL(session.signedUploadUrl).searchParams.get('token');assert.ok(token);
 assert.ok(!(await client.storage.from('upload-originals').uploadToSignedUrl(session.storagePath,token,bytes,{contentType:'image/png',upsert:false})).error);
 const plan=await api('/api/v1/uploads/'+session.uploadId+'/prepare',{},202);assert.equal(plan.state,'stored');assert.equal(plan.pages.length,1);result.upload=true;console.log('PASS: deployed Production create/prepare API and real signed Storage upload.');
 stage='ocr';worker=await createWorker('kor+eng',1,{langPath:resolve('public/ocr/tesseract-7/lang'),cacheMethod:'none',gzip:true,logger:()=>{}});const recognized=await worker.recognize(bytes);await worker.terminate();worker=null;assert.ok(recognized.data.text.includes('한글')&&recognized.data.text.includes('ENGLISH DOCUMENT TEST 12345'));result.ocr=true;
 stage='complete';const complete=await api('/api/v1/uploads/'+session.uploadId+'/complete',{pages:[{page:1,text:recognized.data.text,provider:'tesseract.js',providerVersion:'7.0.0',execution:'client',language:'kor+eng',confidence:recognized.data.confidence/100}]},202);assert.equal(complete.state,'complete');result.complete=true;
 stage='reuse';const replay=await api('/api/v1/uploads/'+session.uploadId+'/complete',{pages:[]},202);assert.equal(replay.itemId,complete.itemId);assert.equal(replay.outcome,'reused');result.reuse=true;console.log('PASS: real OCR text accepted by Production complete; duplicate/reuse preserves ITEM.');
 stage='gemini';await api('/api/v1/items/'+complete.itemId+'/analyze',{});
 const saved=await admin.from('items').select('metadata,source,format').eq('id',complete.itemId).eq('user_id',user.id).single();assert.ok(!saved.error&&saved.data.metadata.aiAnalysis?.result);assert.equal(saved.data.source,'upload');assert.equal(saved.data.format,'image');result.gemini=true;
 stage='item';await api('/api/v1/items/'+complete.itemId);result.item=true;console.log('PASS: deployed Production Gemini analysis persisted and ITEM GET returned 200.');
}catch{result.failedStage=stage;console.error('FAIL: Production smoke at '+stage+'; credentials/data/provider payloads suppressed.');process.exitCode=1;}
finally{
 if(worker)await worker.terminate();let clean=true;
 for(const path of paths){assert.ok(user&&path.startsWith(user.id+'/'));if((await admin.storage.from('upload-originals').remove([path])).error)clean=false;}
 if(user&&(await admin.auth.admin.deleteUser(user.id)).error)clean=false;result.cleanup=clean;result.finishedAt=new Date().toISOString();
 mkdirSync('supabase/.temp',{recursive:true});writeFileSync('supabase/.temp/upload-cpu-production-result.json',JSON.stringify(result));
 if(!clean){console.error('FAIL: exact synthetic cleanup requires follow-up.');process.exitCode=1;}else console.log('PASS: exact synthetic object/account cleaned; existing user data untouched.');
}
