import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {noiseDb} from '../scripts/noise-db.mjs';
import {loadAnalysisModule as load} from './helpers/analysis-loader.mjs';
import {fixture,content} from './helpers/analysis-fixtures.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration='supabase/migrations/20261027090000_gmail_analysis_admission_and_lease_cleanup.sql';
const env={GMAIL_ANALYSIS_WORKER_ENABLED:'true',GEMINI_FREE_TIER_CONFIRMED:'true',GMAIL_ANALYSIS_CRON_SECRET:'s'.repeat(40),GMAIL_ANALYSIS_ALLOWED_USERS:owner,GMAIL_ANALYSIS_DEMO_ITEM_IDS:id(1)};

test('diagnostic history retains safe rule and attempt, and only the owner can read it',async()=>{
 const h=await database(); const {db,scalar}=h;
 try {
  await db.exec(readFileSync('supabase/migrations/20261028090000_analysis_diagnostic_history.sql','utf8'));
  await h.seed(1); await h.schedule(); const j=await h.claim();
  await h.finish(j,null,'ANALYSIS_VALIDATION_REQUIREMENTS');
  const history=await scalar('select public.analysis_diagnostics($1)',[id(1)]);
  assert.ok(history.some(x=>x.error_code==='ANALYSIS_VALIDATION_REQUIREMENTS' && x.source==='gmail_worker' && x.attempt===1));
  assert.ok(!JSON.stringify(history).includes(content));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.equal((await scalar('select public.analysis_diagnostics($1)',[id(1)])).length,0);
  assert.equal(await scalar("select has_table_privilege('authenticated','private.analysis_diagnostic_history','SELECT')"),false);
 } finally { await db.close(); }
});

test('automatic collection lease and analysis queue preserve owner and free budget boundaries',async()=>{
 const h=await database(); const {db,scalar}=h;
 try {
  await db.exec(readFileSync('supabase/migrations/20261028090100_gmail_automatic_processing.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261028090200_gmail_sync_lease_token_access.sql','utf8'));
  assert.equal((await scalar('select public.gmail_automation_state()')).enabled,false);
  assert.equal(await scalar('select public.claim_gmail_sync($1)',[owner]),null);
  await db.query('update private.gmail_automation_config set enabled=true,owner_id=$1',[owner]);
  assert.equal(await scalar('select public.gmail_automatic_available()'),true);
  assert.equal(await scalar('select public.claim_gmail_sync($1)',[other]),null);
  const first=await scalar('select public.claim_gmail_sync($1)',[owner]);
  assert.ok(first.token); assert.equal(await scalar('select public.claim_gmail_sync($1)',[owner]),null);
  assert.equal(await scalar('select public.gmail_sync_lease_valid($1,$2)',[owner,first.token]),true);
  assert.equal(await scalar('select public.gmail_sync_lease_valid($1,$2)',[other,first.token]),false);
  assert.equal(await scalar("select has_function_privilege('authenticated','public.gmail_sync_lease_valid(uuid,uuid)','EXECUTE')"),false);
  assert.equal(await scalar("select public.finish_gmail_sync($1,$2,'complete',null,'{}'::jsonb)",[owner,id(9)]),false);
  assert.equal(await scalar("select public.finish_gmail_sync($1,$2,'partial',null,$3::jsonb)",[owner,first.token,JSON.stringify({collected_count:2,created_count:1,failed_count:1})]),true);
  assert.equal(await scalar('select public.gmail_sync_lease_valid($1,$2)',[owner,first.token]),false);
  assert.equal(await scalar("select count(*)::int from private.gmail_sync_history where state='partial' and failed_count=1"),1);
  const old=await scalar('select public.claim_gmail_sync($1)',[owner]);
  await db.exec("update private.gmail_automation_config set sync_lease_until=clock_timestamp()-interval '1 second'");
  const next=await scalar('select public.claim_gmail_sync($1)',[owner]);
  assert.notEqual(old.token,next.token);
  assert.equal(await scalar("select public.finish_gmail_sync($1,$2,'complete',null,'{}'::jsonb)",[owner,old.token]),false);
  assert.equal(await scalar("select count(*)::int from private.gmail_sync_history where state='interrupted'"),1);
  await h.seed(4); await db.exec("select cron.schedule('etc-gmail-auto-analysis','* * * * *','select 1')");
  assert.equal((await scalar('select public.request_automatic_gmail_analysis($1)',[id(4)])).state,'pending');
  assert.equal(await scalar('select public.claim_gmail_automatic_job($1::uuid[])',[[other]]),null);
  const job=await scalar('select public.claim_gmail_automatic_job($1::uuid[])',[[owner]]);
  assert.equal(job.itemId,id(4)); assert.equal(await scalar('select reserved from private.gmail_free_budget'),1);
  assert.equal(await scalar('select public.claim_gmail_automatic_job($1::uuid[])',[[owner]]),null);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.equal(await scalar('select public.gmail_automatic_available()'),false);
  await assert.rejects(()=>scalar('select public.request_automatic_gmail_analysis($1)',[id(4)]),e=>e.code==='42501');
 } finally { await db.close(); }
});

test('automatic scheduler is opt-in, owner scoped and does not put its secret in HTTP headers',async()=>{
 const h=await database();const {db,scalar}=h;
 try {
  await db.exec(`create schema net; create table net.test_calls(id bigint generated always as identity,url text,headers jsonb,timeout_ms int);
   create table net._http_response(id bigint,status_code integer,timed_out boolean);
   create function extensions.hmac(text,text,text) returns bytea language sql as $$select decode(repeat('ab',32),'hex')$$;
   create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$
   declare n bigint;begin insert into net.test_calls(url,headers,timeout_ms) values(url,headers,timeout_milliseconds) returning id into n;return n;end$$;`);
  await db.exec(readFileSync('supabase/migrations/20261028090100_gmail_automatic_processing.sql','utf8'));
  assert.equal(await scalar("select private.dispatch_gmail_automatic('sync')"),null);
  await db.query('update private.gmail_automation_config set enabled=true,owner_id=$1',[owner]);
  await db.query("insert into vault.decrypted_secrets values('etc_gmail_analysis_url',$1),('etc_gmail_analysis_secret',$2)",['https://ai-hub-one-ebon.vercel.app/api/internal/gmail-analysis','synthetic-secret-which-must-not-be-exposed']);
  assert.equal(await scalar("select private.dispatch_gmail_automatic('analysis')"),null);
  assert.equal(await scalar("select private.dispatch_gmail_automatic('sync')"),1);
  const row=(await db.query('select * from net.test_calls')).rows[0];
  assert.match(row.url,/\/api\/internal\/gmail-sync$/);assert.equal(row.timeout_ms,300000);
  assert.ok(row.headers['x-etc-signature']);assert.ok(!JSON.stringify(row).includes('synthetic-secret'));
  await db.exec('insert into net._http_response values(1,503,false)');
  await h.seed(4);assert.equal(await scalar("select private.dispatch_gmail_automatic('analysis')"),2);
  assert.equal(await scalar('select http_status from private.gmail_dispatch_history where request_id=1'),503);
  await db.exec("update private.gmail_free_budget set budget_day=(clock_timestamp() at time zone 'UTC')::date,reserved=5");
  assert.equal(await scalar("select private.dispatch_gmail_automatic('analysis')"),null);
 } finally { await db.close(); }
});

function apiHarness({environment=env,itemId=id(1),userId=owner,admission={state:'pending',processingStatus:'queued'},rpcError=null,auto=false}={}) {
 let rpcCalls=0,providerCalls=0;
 const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{id:itemId,source:'gmail',format:'email',content_text:content,metadata:{},processing_status:'queued'}})};
 const api=load('src/lib/items/analysis.ts',{
  '@/lib/gemini/client':{getGeminiConfig(){throw new Error('unexpected direct config');},analyzeGmailText(){providerCalls++;throw new Error('unexpected provider');}},
  '@/lib/gemini/validation':{},'@/lib/items/analysis-failure':{},'@/lib/items/filters':{isItemId:()=>true},
  '@/lib/supabase/auth':{requireUser:async()=>({id:userId})},
  '@/lib/supabase/admin':{createAdminClient(){throw new Error('unexpected admin');}},
  '@/lib/supabase/server':{createClient:async()=>({from:()=>q,rpc:async(name,args)=>{if(name==='gmail_automatic_available')return {data:auto,error:null};rpcCalls++;assert.equal(name,auto?'request_automatic_gmail_analysis':'request_gmail_analysis');assert.equal(args.p_item_id,itemId);return {data:admission,error:rpcError};}})},
 },{process:{env:environment}});
 return {api,run:()=>api.analyzeOwnedItem(itemId),counts:()=>({rpcCalls,providerCalls})};
}

test('admission shares exact free-worker owner/item/config scope and never falls back to a provider',async()=>{
 for(const options of [{itemId:id(2)},{userId:other},{environment:{...env,GEMINI_FREE_TIER_CONFIRMED:'false'}},{environment:{...env,GMAIL_ANALYSIS_CRON_SECRET:''}},{environment:{...env,GMAIL_ANALYSIS_DEMO_ITEM_IDS:[1,2,3,4].map(id).join(',')}}]){
  const h=apiHarness(options);
  await assert.rejects(h.run(),e=>e.code===(options.itemId||options.userId?'ANALYSIS_SCOPE_UNAVAILABLE':'ANALYSIS_WORKER_UNAVAILABLE'));
  assert.deepEqual(h.counts(),{rpcCalls:0,providerCalls:0});
 }
 const h=apiHarness();assert.equal((await h.run()).queued,true);assert.deepEqual(h.counts(),{rpcCalls:1,providerCalls:0});
});

test('automatic mode admits an owner item beyond demo IDs without calling the provider',async()=>{
 const h=apiHarness({itemId:id(4),auto:true});assert.equal((await h.run()).queued,true);
 assert.deepEqual(h.counts(),{rpcCalls:1,providerCalls:0});
});

test('admission distinguishes pending, running, complete, paused and rejected state without fake queued success',async()=>{
 const running=apiHarness({admission:{state:'running',processingStatus:'analyzing'}});
 await assert.rejects(running.run(),e=>e.code==='ANALYSIS_IN_PROGRESS');
 for(const processingStatus of ['indexing','completed']){
  const h=apiHarness({admission:{state:'complete',processingStatus}}),result=await h.run();
  assert.equal(result.queued,false);assert.equal(result.processing_status,processingStatus);
 }
 for(const [code,expected] of [['PT503','ANALYSIS_WORKER_PAUSED'],['PT502','ANALYSIS_WORKER_UNAVAILABLE'],['PT403','ANALYSIS_SCOPE_UNAVAILABLE']]){
  await assert.rejects(apiHarness({rpcError:{code}}).run(),e=>e.code===expected);
 }
 await assert.rejects(apiHarness({admission:null}).run(),e=>e.code==='ANALYSIS_STORAGE_UNAVAILABLE');
});

test('HTTP admission returns 202 only for an accepted pending job, and exposes safe actionable errors',async()=>{
 for(const [options,status,code] of [[{},202],[{admission:{state:'complete',processingStatus:'completed'}},200],[{admission:{state:'running',processingStatus:'analyzing'}},409,'ANALYSIS_IN_PROGRESS'],[{itemId:id(2)},403,'ANALYSIS_SCOPE_UNAVAILABLE'],[{rpcError:{code:'PT503'}},503,'ANALYSIS_WORKER_PAUSED']]){
  const h=apiHarness(options);
  const route=load('src/app/api/v1/items/[itemId]/analyze/route.ts',{
   '@/lib/items/analysis':{...h.api,analyzeOwnedItem:h.run},'@/lib/gemini/client':{GeminiAnalysisError:class extends Error{}},
   '@/lib/gemini/validation':{AnalysisValidationError:class extends Error{}},'@/lib/supabase/auth':{AuthenticationRequiredError:class extends Error{}},
   '@/lib/items/write-http':{readWriteBody:async()=>({}),writeErrorResponse(){throw new Error('unexpected write error');}},'@/lib/items/writes':{ItemWriteError:class extends Error{}},
  });
  const response=await route.POST(new Request('https://synthetic.invalid/api',{method:'POST',headers:{origin:'https://synthetic.invalid'}}),{params:Promise.resolve({itemId:id(1)})});
  assert.equal(response.status,status);if(code)assert.equal((await response.json()).error.code,code);
  assert.equal(h.counts().providerCalls,0);
 }
});

async function database({beforeMigration}={}) {
 const db=await noiseDb({migrated:false});
 const sql=path=>readFileSync(path,'utf8').replaceAll('\r\n','\n');
 await db.exec(`create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;
 create schema vault;create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
 create schema cron;create table cron.job(jobid bigint generated always as identity,jobname text unique,schedule text,command text,active boolean default true);
 create function cron.schedule(text,text,text) returns bigint language plpgsql as $$declare n bigint;begin
 insert into cron.job(jobname,schedule,command) values($1,$2,$3) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid into n;return n;end$$;
 create function cron.unschedule(text) returns boolean language plpgsql as $$begin delete from cron.job where jobname=$1;return found;end$$;`);
 await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
 await db.query('insert into public.connections(id,user_id) values($1,$1),($2,$2)',[owner,other]);
 await db.query("insert into vault.decrypted_secrets values('etc_gmail_analysis_user',$1),('etc_gmail_analysis_items',$2)",[owner,[1,2,3].map(id).join(',')]);
 await db.exec(sql('supabase/migrations/20261013030716_gmail_analysis_worker_queue.sql'));
 await db.exec(sql('supabase/migrations/20261013043600_gmail_scheduler_signed_requests.sql'));
 if(beforeMigration)await beforeMigration(db);
 await db.exec(sql(migration));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
 const scalar=async(s,a=[])=>Object.values((await db.query(s,a)).rows[0])[0];
 const seed=async(n,user=owner)=>db.query("insert into public.items(id,user_id,connection_id,external_id,source,format,title,content_text,processing_status) values($1,$2,$2,($1::uuid)::text,'gmail','email','Synthetic',$3,'queued')",[id(n),user,content]);
 const claim=(n=1)=>scalar('select public.claim_free_gmail_analysis_job($1::uuid[],$2::uuid[])',[[owner],[id(n)]]);
 const schedule=()=>db.exec("select cron.schedule('etc-gmail-demo','* * * * *','select private.dispatch_gmail_analysis()')");
 const finish=(j,result=null,error='ANALYSIS_VALIDATION_FAILED')=>scalar('select public.finish_gmail_analysis_job($1,$2,$3,$4::jsonb,$5,$6,$7,null)',[j.userId,j.itemId,j.token,result?JSON.stringify(result):null,'gemini-synthetic',result?load('src/lib/items/analysis-policy.ts').analysisFingerprint(content,'gemini-synthetic','0.2'):null,error]);
 return {db,scalar,seed,claim,schedule,finish};
}

test('fifth reservation crash is reconciled after processing Cron stops with no sixth reservation or provider path',async()=>{
 const h=await database();const {db,scalar}=h;
 try{
  await h.seed(1);await h.schedule();
  await db.exec("update private.gmail_free_budget set reserved=4,next_at=clock_timestamp()-interval '1 second'");
  const j=await h.claim();assert.equal(j.attempt,1);
  const cleanup=(await db.query("select command from cron.job where jobname=$1",['etc-gmail-lease-'+id(1)])).rows[0].command;
  assert.match(cleanup,/^select private.cleanup_gmail_analysis_lease\(/);assert.ok(!/http|claim|runAnalysis/i.test(cleanup));
  assert.equal(await scalar('select private.dispatch_gmail_analysis()'),null);
  assert.equal(await scalar("select count(*)::int from cron.job where jobname='etc-gmail-demo'"),0);
  await db.exec(cleanup);assert.equal(await scalar('select processing_status from public.items where id=$1',[id(1)]),'analyzing');
  assert.equal(await scalar('select count(*)::int from cron.job'),1);
  await db.query("update private.gmail_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where item_id=$1",[id(1)]);
  await db.exec(cleanup);
  assert.equal(await scalar('select processing_status from public.items where id=$1',[id(1)]),'failed');
  assert.equal(await scalar('select processing_error from public.items where id=$1',[id(1)]),'ANALYSIS_WORKER_INTERRUPTED');
  assert.equal(await scalar('select state from private.gmail_analysis_jobs where item_id=$1',[id(1)]),'retry');
  assert.equal(await scalar('select count(*)::int from cron.job'),0);
  assert.equal(await h.claim(),null);assert.equal(await scalar('select reserved from private.gmail_free_budget'),5);
  assert.equal(await scalar('select attempts from private.gmail_analysis_jobs where item_id=$1',[id(1)]),1);
  await assert.rejects(h.finish(j),e=>e.code==='PT409');
  const status=await scalar('select public.gmail_analysis_job_status($1::uuid[])',[[id(1)]]);
  assert.equal(status[0].schedulerAvailable,false);assert.equal(status[0].processingStatus,'failed');
  await assert.rejects(scalar('select public.request_gmail_analysis($1)',[id(1)]),e=>e.code==='PT503');
 }finally{await db.close();}
});

test('quota-independent reconciliation preserves bounded crash retries and tokens, including cleanup after normal finish',async()=>{
 const h=await database();const {db,scalar}=h;
 try{
  await h.seed(1);await h.schedule();const first=await h.claim();
  assert.equal(await h.claim(),null);assert.equal(await scalar('select reserved from private.gmail_free_budget'),1);
  await db.query("update private.gmail_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where item_id=$1",[id(1)]);
  await db.exec("update private.gmail_free_budget set next_at=clock_timestamp()-interval '1 second'");
  const second=await h.claim();assert.equal(second.attempt,2);assert.notEqual(second.token,first.token);
  await assert.rejects(h.finish(first),e=>e.code==='PT409');
  const sourceBefore=await scalar('select content_text from public.items where id=$1',[id(1)]);
  const result=load('src/lib/gemini/validation.ts').validateAnalysis(fixture(),content);
  assert.equal((await h.finish(second,result,null)).state,'complete');
  await db.query("update public.classifications set user_primary_topic='USER EDITED' where user_id=$1",[owner]);
  await db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]);
  assert.equal(await scalar("select count(*)::int from cron.job where jobname like 'etc-gmail-lease-%'"),0);
  assert.equal(await scalar('select processing_status from public.items where id=$1',[id(1)]),'indexing');
  assert.equal(await scalar('select content_text from public.items where id=$1',[id(1)]),sourceBefore);
  assert.equal(await scalar('select user_primary_topic from public.classifications where user_id=$1',[owner]),'USER EDITED');
  assert.equal(await scalar('select count(*)::int from public.action_sources where user_id=$1',[owner]),1);
  assert.equal(await scalar('select reserved from private.gmail_free_budget'),2);
 }finally{await db.close();}
});

test('old cleanup cannot cancel a newer source generation or live replacement lease; deleted jobs remove their cleanup schedule',async()=>{
 const h=await database();const {db,scalar}=h;
 try{
  await h.seed(1);const first=await h.claim();
  await db.query('update public.items set content_text=$2 where id=$1',[id(1),content+' changed']);
  await db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]);
  assert.equal(await scalar('select state from private.gmail_analysis_jobs where item_id=$1',[id(1)]),'pending');
  await db.exec("update private.gmail_free_budget set next_at=clock_timestamp()-interval '1 second'");
  const newer=await h.claim();assert.equal(newer.attempt,1);assert.notEqual(newer.token,first.token);
  await db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]);
  assert.equal(await scalar('select token from private.gmail_analysis_jobs where item_id=$1',[id(1)]),newer.token);
  await assert.rejects(h.finish(first),e=>e.code==='PT409');
  await db.query('delete from public.items where id=$1',[id(1)]);
  await db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]);
  assert.equal(await scalar('select count(*)::int from cron.job'),0);
 }finally{await db.close();}
});

test('expired old lease only marks its exact ITEM snapshot failed and never overwrites a newer analysis or source',async()=>{
 const h=await database();const {db,scalar}=h;
 try{
  await h.seed(1);const old=await h.claim();
  // Another operation changed the ITEM after this lease took its snapshot.
  await db.query("update public.items set metadata=metadata||'{\"newerOperation\":true}'::jsonb,processing_error='NEWER_OPERATION' where id=$1",[id(1)]);
  const before=(await db.query('select processing_status,processing_error,updated_at,metadata from public.items where id=$1',[id(1)])).rows[0];
  await db.query("update private.gmail_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where item_id=$1",[id(1)]);
  await db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]);
  assert.deepEqual((await db.query('select processing_status,processing_error,updated_at,metadata from public.items where id=$1',[id(1)])).rows[0],before);
  assert.equal(await scalar('select state from private.gmail_analysis_jobs where item_id=$1',[id(1)]),'retry');
  await assert.rejects(h.finish(old),e=>e.code==='PT409');
  // Ineligible replacement text does not trigger a new queue row, but its revision
  // is still protected from cleanup of the old worker's lease.
  await db.exec("update private.gmail_free_budget set next_at=clock_timestamp()-interval '1 second'");
  const oldSource=await h.claim();
  await db.query("update public.items set content_text='',processing_error='NEWER_SOURCE' where id=$1",[id(1)]);
  await db.query("update private.gmail_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where item_id=$1",[id(1)]);
  await db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]);
  assert.equal(await scalar('select processing_error from public.items where id=$1',[id(1)]),'NEWER_SOURCE');
  assert.equal(await scalar('select content_text from public.items where id=$1',[id(1)]),'');
  await assert.rejects(h.finish(oldSource),e=>e.code==='PT409');
 }finally{await db.close();}
});

test('five crashed free attempts terminate without a sixth reservation, even through direct cleanup',async()=>{
 const h=await database();const {db,scalar}=h;
 try{
  await h.seed(1);
  for(let n=1;n<=5;n++){
   await db.exec("update private.gmail_free_budget set next_at=clock_timestamp()-interval '1 second'");
   const j=await h.claim();assert.equal(j.attempt,n);
   await db.query("update private.gmail_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where item_id=$1",[id(1)]);
   await db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]);
  }
  assert.equal(await scalar('select state from private.gmail_analysis_jobs where item_id=$1',[id(1)]),'failed');
  assert.equal(await scalar('select processing_status from public.items where id=$1',[id(1)]),'failed');
  assert.equal(await h.claim(),null);assert.equal(await scalar('select reserved from private.gmail_free_budget'),5);
  assert.equal(await scalar('select count(*)::int from cron.job'),0);
 }finally{await db.close();}
});

test('rollout registers cleanup only for already-running approved work and malformed Vault scope fails closed',async()=>{
 const h=await database({beforeMigration:async db=>{
  for(const n of [1,4])await db.query("insert into public.items(id,user_id,connection_id,external_id,source,format,title,content_text,processing_status) values($1,$2,$2,($1::uuid)::text,'gmail','email','Synthetic',$3,'analyzing')",[id(n),owner,content]);
  await db.exec("update private.gmail_analysis_jobs set state='running',token=gen_random_uuid(),lease_until=clock_timestamp()+interval '180 seconds'");
 }});
 try{
  const names=(await h.db.query('select jobname from cron.job')).rows.map(r=>r.jobname);
  assert.deepEqual(names,['etc-gmail-lease-'+id(1)]);
  assert.equal(await h.scalar('select reserved from private.gmail_free_budget'),0);
 }finally{await h.db.close();}
 const invalid=await database({beforeMigration:db=>db.exec("update vault.decrypted_secrets set decrypted_secret='not-a-uuid' where name='etc_gmail_analysis_user'")});
 try{
  await invalid.seed(1);
  await assert.rejects(invalid.scalar('select public.request_gmail_analysis($1)',[id(1)]),e=>e.code==='PT502');
  assert.equal(await invalid.scalar('select count(*)::int from cron.job'),0);
 }finally{await invalid.db.close();}
});

test('DB admission checks actual active scheduler, Vault scope and budget; running/completed requests never reset work',async()=>{
 const h=await database();const {db,scalar}=h;
 const request=n=>scalar('select public.request_gmail_analysis($1)',[id(n)]);
 try{
  await h.seed(1);await h.seed(4);await h.seed(5,other);
  await assert.rejects(request(1),e=>e.code==='PT503');
  await h.schedule();await db.exec("update cron.job set active=false where jobname='etc-gmail-demo'");
  await assert.rejects(request(1),e=>e.code==='PT503');
  await h.schedule();await assert.rejects(request(4),e=>e.code==='PT403');
  await assert.rejects(request(5),e=>e.code==='42501');
  assert.equal((await request(1)).state,'pending');
  const first=await h.claim();assert.equal((await request(1)).state,'running');
  assert.equal(await scalar('select token from private.gmail_analysis_jobs where item_id=$1',[id(1)]),first.token);
  const result=load('src/lib/gemini/validation.ts').validateAnalysis(fixture(),content);
  await h.finish(first,result,null);await db.exec("select cron.unschedule('etc-gmail-demo')");
  assert.equal((await request(1)).state,'complete');
  assert.equal(await scalar('select state from private.gmail_analysis_jobs where item_id=$1',[id(1)]),'complete');
  await h.seed(2);await h.schedule();await db.exec('update private.gmail_free_budget set reserved=5');
  await assert.rejects(request(2),e=>e.code==='PT503');
  assert.equal(await scalar('select attempts from private.gmail_analysis_jobs where item_id=$1',[id(2)]),0);
 }finally{await db.close();}
});

test('job status is read-only, bounded, owner scoped, has no tokens, and cleanup/admission permissions stay narrow',async()=>{
 const h=await database();const {db,scalar}=h;
 try{
  await h.seed(1);await h.seed(4);await h.seed(5,other);await h.schedule();
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false);set role authenticated");
  const rows=await scalar('select public.gmail_analysis_job_status($1::uuid[])',[[id(1),id(4),id(5)]]);
  assert.equal(rows.length,2);assert.equal(rows.find(r=>r.itemId===id(1)).schedulerAvailable,true);
  assert.equal(rows.find(r=>r.itemId===id(4)).schedulerAvailable,false);assert.ok(rows.every(r=>!('token' in r)));
  await assert.rejects(scalar('select public.gmail_analysis_job_status($1::uuid[])',[Array(101).fill(id(1))]),e=>e.code==='42501');
  await assert.rejects(db.query('select private.cleanup_gmail_analysis_lease($1,$2)',[owner,id(1)]),/permission denied/);
  await assert.rejects(db.query('select * from private.gmail_analysis_jobs'),/permission denied/);
  await db.exec('reset role;set role anon');
  await assert.rejects(scalar('select public.gmail_analysis_job_status($1::uuid[])',[[id(1)]]),/permission denied/);
  await assert.rejects(scalar('select public.request_gmail_analysis($1)',[id(1)]),/permission denied/);
  await db.exec('reset role');
  assert.equal(await scalar('select reserved from private.gmail_free_budget'),0);
 }finally{await db.close();}
});
