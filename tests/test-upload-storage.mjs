// Actual Storage HTTP / authenticated principals. Synthetic test users and exact objects cleaned.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import nextEnv from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {load} from './helpers/calendar-loader.mjs';
import {imageFixture} from './helpers/upload-fixtures.mjs';
import {isolatedInspect} from '../workers/upload/isolate.mjs';
import {loadAnalysisModule} from './helpers/analysis-loader.mjs';
nextEnv.loadEnvConfig(process.cwd());
const c=load('src/lib/uploads/contract.ts'),bucket='upload-originals';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname,'oclzdppdiljbojvqtkeu.supabase.co');
assert.equal(process.env.UPLOAD_DB_TEST_PROJECT,'oclzdppdiljbojvqtkeu');
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}};
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const ids=[],paths=[];let stage='auth';
const rpc=async(op,user,id=null,payload=null,keyId=randomUUID())=>{
 const {data,error}=await admin.rpc('upload_session_rpc',{p_operation:op,p_user_id:user,p_upload_id:id,p_key:keyId,p_request:{fileName:'synthetic.png',mimeType:'image/png',size:bytes.length},p_payload:payload,p_attempt:null});assert.ok(!error,'RPC rejected');return data;
};
const bytes=await imageFixture('png');
async function principal(){
 const email=`upload3-${randomUUID()}@example.invalid`,password=randomBytes(36).toString('base64url');
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!error&&data.user);ids.push(data.user.id);
 const client=createClient(url,key,options);assert.ok(!(await client.auth.signInWithPassword({email,password})).error);return {id:data.user.id,client};
}
try{
 const owner=await principal(),foreign=await principal(),anon=createClient(url,key,options);
 const s=await rpc('create',owner.id);assert.equal(s.path,c.uploadPath(owner.id,s.id,'image/png'));paths.push(s.path);
 stage='authenticated-upload';assert.ok(!(await owner.client.storage.from(bucket).upload(s.path,bytes,{contentType:'image/png',upsert:false})).error);
 const signed=await rpc('create',owner.id);paths.push(signed.path);
 const token=await admin.storage.from(bucket).createSignedUploadUrl(signed.path,{upsert:false});assert.ok(!token.error);
 assert.ok(!(await owner.client.storage.from(bucket).uploadToSignedUrl(signed.path,token.data.token,bytes,{contentType:'image/png',upsert:false})).error);
 assert.ok((await owner.client.storage.from(bucket).uploadToSignedUrl(signed.path,token.data.token,bytes,{contentType:'image/png',upsert:false})).error,'Signed overwrite must reject');
 stage='path-access';
 for(const [client,path] of [[owner.client,`${owner.id}/${randomUUID()}/original.png`],[owner.client,`${foreign.id}/${randomUUID()}/original.png`],[foreign.client,s.path],[anon,s.path]]){
   assert.ok((await client.storage.from(bucket).upload(path,bytes,{contentType:'image/png',upsert:false})).error,'Unauthorized INSERT must reject');
 }
 const plan=await isolatedInspect(bytes,'image/png');assert.equal(plan.rawHash,c.sha256(bytes));
 const pending=await rpc('pending',owner.id,s.id,{rawHash:c.sha256(bytes)});assert.ok(pending.itemId);
 stage='production-read-contracts';
 class AuthenticationRequiredError extends Error {}
 const moduleFor=(principal)=>{
   const auth={AuthenticationRequiredError,requireUser:async()=>{const {data,error}=await principal.client.auth.getUser();if(error||!data.user)throw new AuthenticationRequiredError();return data.user;}};
   const imports={'@/lib/uploads/contract':c,'@/lib/supabase/auth':auth,'@/lib/supabase/server':{createClient:async()=>principal.client},'@/lib/supabase/admin':{createAdminClient:()=>admin},'@/lib/uploads/providers':{}};
   const service=load('src/lib/uploads/service.ts',imports);
   const http=load('src/lib/uploads/http.ts',{'@/lib/uploads/contract':c,'@/lib/uploads/service':service,'@/lib/supabase/auth':auth});
   const route=load('src/app/api/v1/items/[itemId]/original/route.ts',{'@/lib/uploads/service':service,'@/lib/uploads/http':http});
   return {route,imports};
 };
 const owned=moduleFor(owner),foreignModule=moduleFor(foreign),anonymousModule=moduleFor({client:anon});
 const apiRequest=new Request('http://localhost/api/v1/items/test/original?storagePath=arbitrary/path');
 const responseContext={params:Promise.resolve({itemId:pending.itemId})};
 const original=await owned.route.GET(apiRequest,responseContext);assert.equal(original.status,200);assert.match(original.headers.get('cache-control'),/private, no-store/);
 const originalResult=await original.json();const tokenQuery=new URL(originalResult.downloadUrl).searchParams.get('token');
 const decoded=JSON.parse(Buffer.from(tokenQuery.split('.')[1],'base64url').toString());assert.equal(decoded.exp-decoded.iat,60);
 assert.equal((await foreignModule.route.GET(apiRequest,responseContext)).status,404);assert.equal((await anonymousModule.route.GET(apiRequest,responseContext)).status,401);
 const filters=load('src/lib/items/filters.ts',{'@/types/database':load('src/types/database.ts')});
 const queries=load('src/lib/items/queries.ts',{...owned.imports,'@/lib/google/calendar-contract':load('src/lib/google/calendar-contract.ts'),'@/lib/items/filters':filters,'@/lib/items/presentation':load('src/lib/items/presentation.ts'),'@/lib/gemini/validation':loadAnalysisModule('src/lib/gemini/validation.ts')});
 const detail=await queries.getItemDetail(pending.itemId);assert.equal(detail.upload.extractionStatus,'pending');assert.equal(detail.original.url,null);assert.equal(detail.aiAnalysis,null);assert.equal(detail.actions.length,0);assert.ok(!JSON.stringify(detail).includes(s.path));assert.ok(!JSON.stringify(detail).includes(c.sha256(bytes)));
 assert.ok((await queries.listItems(filters.parseItemQuery(new URLSearchParams({source:'upload',limit:'100'})))).items.some(i=>i.id===pending.itemId));
 stage='owner-read';const own=await owner.client.storage.from(bucket).download(s.path);assert.ok(!own.error);assert.equal(c.sha256(Buffer.from(await own.data.arrayBuffer())),c.sha256(bytes));
 const signedRead=await owner.client.storage.from(bucket).createSignedUrl(s.path,60,{download:true});assert.ok(!signedRead.error);
 const response=await fetch(signedRead.data.signedUrl,{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);assert.equal(c.sha256(Buffer.from(await response.arrayBuffer())),c.sha256(bytes));
 const encoded=encodeURIComponent(signedRead.data.signedUrl).length;assert.ok(encoded>0); // Never print or persist URL.
 stage='isolation';
 for(const [label,client] of [['foreign',foreign.client],['anon',anon]]){
   stage=`${label}-read`;
   assert.ok((await client.storage.from(bucket).download(s.path)).error);
   assert.ok((await client.storage.from(bucket).createSignedUrl(s.path,60)).error);
   const item=await client.from('items').select('id').eq('id',pending.itemId);assert.ok(item.error||item.data.length===0);
 }
 stage='public-url';const publicResponse=await fetch(`${url}/storage/v1/object/public/${bucket}/${s.path}`,{signal:AbortSignal.timeout(20000)});assert.ok(!publicResponse.ok);await publicResponse.body?.cancel();
 stage='overwrite';
 assert.ok((await owner.client.storage.from(bucket).upload(s.path,Buffer.from('changed'),{contentType:'image/png',upsert:true})).error);
 const still=await owner.client.storage.from(bucket).download(s.path);assert.ok(!still.error);assert.equal(c.sha256(Buffer.from(await still.data.arrayBuffer())),c.sha256(bytes));
 stage='delete';const remove=await owner.client.storage.from(bucket).remove([s.path]);assert.ok(remove.error||remove.data?.length===0);assert.ok(!(await owner.client.storage.from(bucket).download(s.path)).error);
 console.log('PASS: actual authenticated + signed INSERT, private/public denial, owner read and 60s signing, foreign/anon/path/prefix rejection, overwrite/delete denial, original hash unchanged; no OCR/AI call.');
 console.log('PASS: production Original GET handler/Library/Detail using real authenticated principal, 60s/no-store/foreign404/anon401/canonical path and safe metadata. Direct handler + CLI session adapter; browser HTTP E2E not claimed.');
}catch{console.error(`FAIL: Storage Runtime at ${stage}; response/path/credential details suppressed.`);process.exitCode=1;}
finally{
 let cleaned=true;
 for(const path of paths){assert.ok(ids.some(id=>path.startsWith(`${id}/`)));if((await admin.storage.from(bucket).remove([path])).error)cleaned=false;}
 for(const id of ids)if((await admin.auth.admin.deleteUser(id)).error)cleaned=false;
 if(!cleaned){console.error('FAIL: synthetic cleanup incomplete; retained internal identifiers require follow-up.');process.exitCode=1;}
 else console.log('PASS: exact synthetic objects and test users cleaned; no existing user data removed.');
}
