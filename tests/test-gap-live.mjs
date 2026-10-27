// Explicit dev target. Synthetic principals/corpus only; real HTTP/RLS, ZERO Gemini calls.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {loadAnalysisModule as load} from './helpers/analysis-loader.mjs';
import {fixture,content} from './helpers/analysis-fixtures.mjs';
process.loadEnvFile('.env.local');
assert.equal(process.env.GAP_E2E_PROJECT,'oclzdppdiljbojvqtkeu');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname,'oclzdppdiljbojvqtkeu.supabase.co');
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const users=[],base='http://localhost:3000';let checks=0;
const ok=async(p,label)=>{const r=await p;assert.ok(!r.error,label);return r.data;};
async function principal(){
 const password=randomBytes(32).toString('base64url'),email=`gap-${randomUUID()}@example.invalid`;
 const data=await ok(admin.auth.admin.createUser({email,password,email_confirm:true}),'synthetic principal');users.push(data.user.id);
 let cookies=[];const client=createServerClient(url,key,{cookies:{getAll:()=>cookies,setAll:v=>{for(const c of v){cookies=cookies.filter(x=>x.name!==c.name);cookies.push(c);}}}});
 await ok(client.auth.signInWithPassword({email,password}),'synthetic sign-in');
 return {id:data.user.id,client,cookie:()=>cookies.map(c=>`${c.name}=${c.value}`).join('; ')};
}
async function http(path,{user,method='GET',body}={}) {
 const r=await fetch(base+path,{method,headers:{origin:base,...(user?{cookie:user.cookie()}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 const data=await r.json();return {status:r.status,data};
}
async function check(name,fn){await fn();checks++;console.log('PASS: '+name);}
try {
 const a=await principal(),b=await principal();
 const connection=await ok(admin.from('connections').insert({user_id:a.id,provider:'google',provider_account_id:`gap-${randomUUID()}`,status:'disconnected'}).select('id').single(),'synthetic connection');
 const item=await ok(admin.from('items').insert({user_id:a.id,connection_id:connection.id,source:'drive',format:'document',external_id:randomUUID(),title:'Synthetic Backend HTTP Test',content_text:content,processing_status:'queued'}).select('id').single(),'synthetic ITEM');
 const validator=load('src/lib/gemini/validation.ts'),valid=validator.validateAnalysis(fixture(),content);
 const persist=(v)=>ok(admin.rpc('persist_eligible_item_analysis',{p_user_id:a.id,p_item_id:item.id,p_content_text:content,p_content_hash:null,p_analysis:v,p_model:'gemini-fixture',p_input_fingerprint:'a'.repeat(64)}),'synthetic atomic analysis');
 await persist(valid);
 const classificationPath=`/api/v1/items/${item.id}/classification`;
 await check('real owner Classification PATCH + Detail exposes AI/User/effective',async()=>{
  const r=await http(classificationPath,{user:a,method:'PATCH',body:{primaryTopic:'HTTP 사용자 주제'}});assert.equal(r.status,200);assert.equal(r.data.editedByUser,true);
  const detail=await http(`/api/v1/items/${item.id}`,{user:a});assert.equal(detail.status,200);assert.equal(detail.data.effectiveClassification.primaryTopic,'HTTP 사용자 주제');assert.equal(detail.data.aiClassification.primaryTopic,valid.classification.primaryTopic);
 });
 await check('real Classification anonymous/foreign/arbitrary/unknown field isolation',async()=>{
  for(const [user,status]of [[undefined,401],[b,404]])assert.equal((await http(classificationPath,{user,method:'PATCH',body:{primaryTopic:'No'}})).status,status);
  assert.equal((await http(`/api/v1/items/${randomUUID()}/classification`,{user:a,method:'PATCH',body:{primaryTopic:'No'}})).status,404);
  assert.equal((await http(classificationPath,{user:a,method:'PATCH',body:{userId:b.id}})).status,400);
 });
 await check('real changed AI persistence retains user override and preserves original AI independently',async()=>{
  const changed=structuredClone(valid);changed.classification.primaryTopic='Changed AI Classification';await persist(changed);
  const d=(await http(`/api/v1/items/${item.id}`,{user:a})).data;assert.equal(d.effectiveClassification.primaryTopic,'HTTP 사용자 주제');assert.equal(d.aiClassification.primaryTopic,'Changed AI Classification');
 });
 const source=await ok(admin.from('action_sources').select('action_id').eq('item_id',item.id).eq('user_id',a.id).single(),'synthetic Action');
 const actionPath=`/api/v1/actions/${source.action_id}/status`;
 const evidenceBefore=await ok(admin.from('action_sources').select('*').eq('user_id',a.id),'synthetic Evidence');
 const actionBefore=await ok(admin.from('actions').select('deadline_status,deadline_date,deadline_at,deadline_source_id,requirements,conditions').eq('id',source.action_id).single(),'synthetic deadline');
 const search=()=>http('/api/v1/search',{user:a,method:'POST',body:{query:'해야 할 일',semantic:false}});
 await check('real complete is idempotent; open Search excludes and completed list includes',async()=>{
  assert.ok((await search()).data.results.some(r=>r.actionId===source.action_id));
  const r=await http(actionPath,{user:a,method:'PATCH',body:{status:'completed'}}),again=await http(actionPath,{user:a,method:'PATCH',body:{status:'completed'}});
  assert.equal(r.status,200);assert.equal(r.data.completed,true);assert.equal(again.data.completedAt,r.data.completedAt);
  assert.ok(!(await search()).data.results.some(r=>r.actionId===source.action_id));
  assert.ok((await http('/api/v1/actions?status=completed',{user:a})).data.results.some(r=>r.actionId===source.action_id));
 });
 await check('real restore is idempotent; open Search/list reinclude with no deadline/evidence mutation',async()=>{
  const r=await http(actionPath,{user:a,method:'PATCH',body:{status:'open'}}),again=await http(actionPath,{user:a,method:'PATCH',body:{status:'open'}});assert.equal(r.data.completedAt,null);assert.equal(again.data.updatedAt,r.data.updatedAt);
  assert.ok((await search()).data.results.some(r=>r.actionId===source.action_id));assert.ok((await http('/api/v1/actions',{user:a})).data.results.some(r=>r.actionId===source.action_id));
  assert.deepEqual(await ok(admin.from('action_sources').select('*').eq('user_id',a.id),'Evidence after'),evidenceBefore);
  assert.deepEqual(await ok(admin.from('actions').select('deadline_status,deadline_date,deadline_at,deadline_source_id,requirements,conditions').eq('id',source.action_id).single(),'deadline after'),actionBefore);
 });
 await check('real Action anonymous/foreign/arbitrary/client completedAt rejection',async()=>{
  for(const [user,status]of [[undefined,401],[b,404]])assert.equal((await http(actionPath,{user,method:'PATCH',body:{status:'completed'}})).status,status);
  assert.equal((await http(`/api/v1/actions/${randomUUID()}/status`,{user:a,method:'PATCH',body:{status:'completed'}})).status,404);
  assert.equal((await http(actionPath,{user:a,method:'PATCH',body:{status:'completed',completedAt:'invented'}})).status,400);
 });
 await check('real analyze owner boundary rejects foreign/anonymous/client userId before provider',async()=>{
  const path=`/api/v1/items/${item.id}/analyze`;
  assert.equal((await http(path,{method:'POST',body:{}})).status,401);assert.equal((await http(path,{user:b,method:'POST',body:{}})).status,404);
  assert.equal((await http(path,{user:a,method:'POST',body:{userId:b.id}})).status,400);
 });
 await check('real Action cursor filter/owner tampering rejection',async()=>{
  assert.equal((await http('/api/v1/actions?status=completed&userId=x',{user:a})).status,400);
  const page=(await http('/api/v1/actions?limit=1',{user:a})).data;
  // The fixture has one Action; no cursor expected. Malformed cursor is still rejected.
  assert.equal(page.nextCursor,null);assert.equal((await http('/api/v1/actions?cursor=bad',{user:b})).status,400);
 });
 console.log(`PASS: ${checks} actual HTTP/RLS checks; Gemini calls=0; synthetic cleanup follows.`);
} catch(error){console.error('FAIL: synthetic GAP HTTP checks; '+(error.code??error.name??'validation'));process.exitCode=1;}
finally {for(const id of users.reverse())await ok(admin.auth.admin.deleteUser(id),'synthetic principal cleanup');console.log('Cleanup: synthetic principals and their cascade corpus removed. Existing user data untouched.');}
