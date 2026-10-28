import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {noiseDb} from '../scripts/noise-db.mjs';
import {loadAnalysisModule as load} from './helpers/analysis-loader.mjs';
import {fixture,content} from './helpers/analysis-fixtures.mjs';

const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const validator=load('src/lib/gemini/validation.ts');
const policy=load('src/lib/items/analysis-policy.ts');
const client=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator});
const failure=load('src/lib/items/analysis-failure.ts',{'@/lib/gemini/validation':validator,'@/lib/gemini/client':client});

test('worker safe failure codes separate HTTP/config/timeout/validation/storage and cooldown',()=>{
  for (const status of [400,401,403,404,429,503]) {
    const f=failure.analysisFailure(new client.GeminiAnalysisError('GEMINI_UNAVAILABLE',status,undefined,180),2);
    assert.equal(f.code,`GEMINI_HTTP_${status}`); assert.equal(f.retrySeconds,[429,503].includes(status)?180:null);
  }
  assert.equal(failure.analysisFailure(new client.GeminiAnalysisError('GEMINI_UNAVAILABLE',undefined,'timeout')).code,'GEMINI_TIMEOUT');
  assert.equal(failure.analysisFailure(new validator.AnalysisValidationError()).retrySeconds,null);
  assert.equal(failure.analysisFailure(new validator.AnalysisValidationError('REQUIREMENTS')).code,'ANALYSIS_VALIDATION_REQUIREMENTS');
  assert.equal(failure.analysisFailure(new validator.AnalysisValidationError('private body')).code,'ANALYSIS_VALIDATION_FAILED');
  assert.equal(failure.analysisFailure(new client.GeminiAnalysisError('GEMINI_NOT_CONFIGURED')).retrySeconds,null);
  assert.equal(failure.analysisFailure(new Error('ANALYSIS_STORAGE_UNAVAILABLE')).retrySeconds,60);
  assert.equal(failure.analysisFailure(new Error('private source text')).code,'ANALYSIS_FAILED');
});

test('free demo rejects missing/incorrect secrets, disabled free tier and client scope expansion',()=>{
  const env={GMAIL_ANALYSIS_CRON_SECRET:'a'.repeat(40),GMAIL_ANALYSIS_WORKER_ENABLED:'true',GEMINI_FREE_TIER_CONFIRMED:'true',GMAIL_ANALYSIS_ALLOWED_USERS:owner,GMAIL_ANALYSIS_DEMO_ITEM_IDS:id(1)};
  const config=load('src/lib/items/free-analysis-config.ts',{}, {process:{env}});
  assert.throws(()=>config.freeAnalysisConfig(null),/UNAUTHORIZED/);
  assert.throws(()=>config.freeAnalysisConfig('Bearer invalid'),/UNAUTHORIZED/);
  assert.equal(config.freeAnalysisConfig('Bearer '+env.GMAIL_ANALYSIS_CRON_SECRET).items[0],id(1));
  env.GEMINI_FREE_TIER_CONFIRMED='false';assert.throws(()=>config.freeAnalysisConfig('Bearer '+env.GMAIL_ANALYSIS_CRON_SECRET),/DISABLED/);
  env.GEMINI_FREE_TIER_CONFIRMED='true';env.GMAIL_ANALYSIS_DEMO_ITEM_IDS=[1,2,3,4].map(id).join(',');
  assert.throws(()=>config.freeAnalysisConfig('Bearer '+env.GMAIL_ANALYSIS_CRON_SECRET),/SCOPE/);
});

test('free demo makes one provider attempt on 429, preserving quota for a later invocation',async()=>{
  let calls=0;
  const limited=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator},{process:{env:{GEMINI_API_KEY:'synthetic',GEMINI_MODEL:'gemini-synthetic'}},fetch:async()=>{calls++;return Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'71461s'}]}},{status:429});}});
  await assert.rejects(()=>limited.analyzeGmailText(content,[],undefined,'0.2',{maxAttempts:1}),e=>e.httpStatus===429&&e.retryAfterSeconds===71461);
  assert.equal(calls,1);
});

test('scheduler HMAC accepts a fresh signed POST and rejects expired, tampered and wrong-path signatures',()=>{
  const secret='s'.repeat(40), stamp=String(Math.floor(Date.now()/1000));
  const config=load('src/lib/items/free-analysis-config.ts',{}, {process:{env:{GMAIL_ANALYSIS_CRON_SECRET:secret,GMAIL_ANALYSIS_WORKER_ENABLED:'true',GEMINI_FREE_TIER_CONFIRMED:'true',GMAIL_ANALYSIS_ALLOWED_USERS:owner,GMAIL_ANALYSIS_DEMO_ITEM_IDS:id(1)}}});
  const sign=(time,path='/api/internal/gmail-analysis')=>createHmac('sha256',secret).update(`POST\n${path}\n${time}`).digest('hex');
  assert.equal(config.freeAnalysisConfig(null,stamp,sign(stamp)).items[0],id(1));
  const old=String(Number(stamp)-121);
  assert.throws(()=>config.freeAnalysisConfig(null,old,sign(old)),/UNAUTHORIZED/);
  assert.throws(()=>config.freeAnalysisConfig(null,stamp,'f'.repeat(64)),/UNAUTHORIZED/);
  assert.throws(()=>config.freeAnalysisConfig(null,stamp,sign(stamp,'/other')),/UNAUTHORIZED/);
});

test('free Vercel entrypoint rejects unauthorized calls before admin access and awaits one scoped job',async()=>{
  let adminCalls=0,invocations=0;
  const route=load('src/app/api/internal/gmail-analysis/route.ts',{
    '@/lib/items/free-analysis-config':{freeAnalysisConfig:authorization=>{if(authorization!=='Bearer synthetic')throw new Error('UNAUTHORIZED');return {users:[owner],items:[id(1)]};}},
    '@/lib/supabase/admin':{createAdminClient:()=>{adminCalls++;return {}; }},
    '@/lib/items/analysis-job-rpc':{analysisJobRpc:async()=>({data:null,error:{code:'42883'}})},
    '../../../../../workers/analysis/runner':{runAnalysisBatch:async(_admin,users,count,items)=>{invocations++;assert.deepEqual(users,[owner]);assert.deepEqual(items,[id(1)]);assert.equal(count,1);return {complete:1};}},
  },{Error});
  assert.equal((await route.POST(new Request('https://synthetic.invalid',{method:'POST'}))).status,401);
  assert.equal(adminCalls,0);
  assert.equal((await route.POST(new Request('https://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer synthetic'},body:'{"user":"foreign"}'}))).status,400);
  assert.equal(adminCalls,0);
  const result=await route.POST(new Request('https://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer synthetic'}}));
  assert.equal(result.status,200);assert.equal((await result.json()).complete,1);assert.equal(invocations,1);
});

test('automatic sync authenticates the route, holds one lease and records sanitized outcomes',async()=>{
 const secret='s'.repeat(40), stamp=String(Math.floor(Date.now()/1000));
 const config=load('src/lib/items/free-analysis-config.ts',{}, {Error,process:{env:{GMAIL_ANALYSIS_CRON_SECRET:secret}}});
 const sign=path=>createHmac('sha256',secret).update(`POST\n${path}\n${stamp}`).digest('hex');
 assert.throws(()=>config.authenticateScheduler(null,stamp,sign('/api/internal/gmail-analysis'),'/api/internal/gmail-sync'),/UNAUTHORIZED/);
 let reads=0,collects=0,finished=[]; let cap=false, fail=false;
 class CollectionError extends Error { constructor(code){super(code);this.code=code;} }
 const route=load('src/app/api/internal/gmail-sync/route.ts',{
  '@/lib/items/free-analysis-config':config,
  '@/lib/items/free-analysis-scope':{freeAnalysisScope:()=>({users:[owner]})},
  '@/lib/supabase/admin':{createAdminClient:()=>({})},
  '@/lib/google/gmail-client':{GmailCollectionError:CollectionError},
  '@/lib/google/gmail-collection':{collectScheduledGmail:async (user,token)=>{collects++;assert.equal(user,owner);assert.equal(token,id(9));if(fail)throw new CollectionError('REFRESH_FAILED');return {complete:true,capped:cap,collected_count:1,created_count:1,updated_count:0,failed_count:0,analysisItemIds:['secret-id']};}},
  '@/lib/items/analysis-job-rpc':{analysisJobRpc:async(_admin,name,args)=>{reads++; if(name==='gmail_automation_state')return {data:{enabled:true,owner},error:null};if(name==='claim_gmail_sync')return {data:{token:id(9)},error:null};if(name==='finish_gmail_sync'){finished.push(args);return {data:true,error:null};}throw new Error('unexpected RPC');}},
 },{Error});
 const request=(headers={},body='{}')=>new Request('https://synthetic.invalid',{method:'POST',headers,body});
 assert.equal((await route.POST(request())).status,401);assert.equal(reads,0);
 const headers={'x-etc-timestamp':stamp,'x-etc-signature':sign('/api/internal/gmail-sync')};
 assert.equal((await route.POST(request(headers,'{"owner":"other"}'))).status,400);assert.equal(collects,0);
 const ok=await route.POST(request(headers));assert.equal(ok.status,200);assert.equal((await ok.json()).state,'complete');assert.equal(finished.at(-1).p_state,'complete');
 cap=true;assert.equal((await (await route.POST(request(headers))).json()).state,'partial');
 fail=true;const failed=await route.POST(request(headers));assert.equal(failed.status,503);assert.equal(finished.at(-1).p_error_code,'REFRESH_FAILED');
 assert.ok(!JSON.stringify(finished).includes('secret-id'));
});

test('provider evidence locators are constrained to unknown/null; server still validates quotes and derives offsets',()=>{
  const schema=client.generationSchema({type:'object',properties:{kind:{type:'string'},page:{},section:{},startChar:{},endChar:{},field:{}}});
  assert.deepEqual(Array.from(schema.properties.kind.enum),['unknown']);
  assert.equal(schema.properties.startChar.type,'null');
  const validated=validator.validateAnalysis(fixture(),content);
  assert.equal(validated.actions[0].evidence[0].locator.kind,'text_span');
  const invalid=fixture();invalid.actions[0].evidence[0].text='NOT IN SOURCE';
  assert.throws(()=>validator.validateAnalysis(invalid,content),validator.AnalysisValidationError);
});

test('202 enqueue is never reported as completed analysis',async()=>{
  const orchestration=load('src/lib/items/browser-analysis.ts',{}, {fetch:async()=>new Response('{}',{status:202})});
  const result=await orchestration.runBoundedAnalysis(['a','b','c','d']);
  assert.equal(result.complete,0);assert.equal(result.queued,3);assert.match(result.message,/백그라운드 처리 요청 3/);
});

test('authenticated Gmail API enqueues the approved owner without calling Gemini or creating admin client',async()=>{
  let calls=0;
  const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{id:id(1),source:'gmail',format:'email',content_text:content}})};
  const api=load('src/lib/items/analysis.ts',{'@/lib/gemini/validation':validator,'@/lib/gemini/client':client,
    '@/lib/items/analysis-failure':failure,'@/lib/items/filters':{isItemId:()=>true},
    '@/lib/supabase/auth':{requireUser:async()=>({id:owner})},
    '@/lib/supabase/server':{createClient:async()=>({from:()=>q,rpc:async(name,args)=>{if(name==='gmail_automatic_available')return {data:false,error:null};calls++;assert.equal(name,'request_gmail_analysis');assert.equal(args.p_item_id,id(1));return {data:{state:'pending',processingStatus:'queued'},error:null};}})},
    '@/lib/supabase/admin':{createAdminClient:()=>{throw new Error('must not write');}}},
    {process:{env:{GMAIL_ANALYSIS_WORKER_ENABLED:'true',GMAIL_ANALYSIS_ALLOWED_USERS:owner,GMAIL_ANALYSIS_DEMO_ITEM_IDS:id(1),GEMINI_FREE_TIER_CONFIRMED:'true',GMAIL_ANALYSIS_CRON_SECRET:'s'.repeat(40)}}});
  assert.equal((await api.analyzeOwnedItem(id(1))).queued,true);assert.equal(calls,1);
});

test('queue SQL: real persistence, leases, retries, owner boundary, source/evidence and User Edited protection',async t=>{
  const db=await noiseDb({migrated:false});
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const claim=()=>scalar('select public.claim_gmail_analysis_job($1::uuid[])',[[owner]]);
  const finish=(j,result=null,error=null,retry=null)=>scalar('select public.finish_gmail_analysis_job($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',[
    j.userId,j.itemId,j.token,result?JSON.stringify(result):null,'gemini-synthetic',result?policy.analysisFingerprint(content,'gemini-synthetic','0.2'):null,error,retry]);
  const seed=(n,user=owner,text=content)=>db.query("insert into public.items(id,user_id,connection_id,external_id,source,format,title,content_text,processing_status) values($1::uuid,$2,$2,($1::uuid)::text,'gmail','email','E2E Synthetic Gmail',$3,'queued')",[id(n),user,text]);
  try {
    await db.exec(`create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;`);
    await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
    await db.query('insert into public.connections(id,user_id) values($1,$1),($2,$2)',[owner,other]);
    await seed(0);
    await db.exec(readFileSync('supabase/migrations/20261013030716_gmail_analysis_worker_queue.sql','utf8'));
    assert.equal(await scalar('select count(*)::int from private.gmail_analysis_jobs'),0);
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    await t.test('no historic automatic backfill; trigger queues only Gmail canonical text',async()=>{
      await seed(1);await seed(2,other);assert.equal(await scalar('select count(*)::int from private.gmail_analysis_jobs'),2);
      await db.query("insert into public.items(id,user_id,source,format,title,content_text) values($1,$2,'manual','text','TEST','TEST')",[id(3),owner]);
      assert.equal(await scalar('select count(*)::int from private.gmail_analysis_jobs'),2);
    });
    let j;
    await t.test('claim is owner scoped and competing claim cannot duplicate a live lease',async()=>{
      j=await claim();assert.equal(j.itemId,id(1));assert.equal(j.userId,owner);assert.equal(j.attempt,1);assert.equal(await claim(),null);
    });
    await t.test('retry schedules in future and does not busy loop',async()=>{
      assert.equal((await finish(j,null,'GEMINI_HTTP_503',60)).state,'retry');assert.equal(await claim(),null);
      await db.exec("update private.gmail_analysis_jobs set available_at=now()-interval '1 second' where state='retry'");
      j=await claim();assert.equal(j.attempt,2);
    });
    await t.test('real existing atomic RPC stores one Action with Evidence and Event',async()=>{
      const result=validator.validateAnalysis(fixture(),content);
      assert.equal((await finish(j,result)).state,'complete');
      assert.equal(await scalar('select count(*)::int from public.actions where user_id=$1',[owner]),1);
      assert.equal(await scalar('select count(*)::int from public.action_sources where user_id=$1',[owner]),1);
      assert.ok((await scalar('select metadata from public.items where id=$1',[id(1)])).aiAnalysis.result.eventObservations.length);
    });
    await t.test('duplicate finish is fenced; explicit cached retry preserves override and Source IDs',async()=>{
      await assert.rejects(()=>finish(j,validator.validateAnalysis(fixture(),content)),/Stale attempt/);
      const sources=(await db.query('select id,evidence_text from public.action_sources where user_id=$1',[owner])).rows;
      await db.query("update public.classifications set user_primary_topic='USER EDITED' where user_id=$1",[owner]);
      await scalar('select public.enqueue_gmail_analysis($1,$2::uuid[])',[owner,[id(1)]]);
      j=await claim();await finish(j,validator.validateAnalysis(fixture(),content));
      assert.equal(await scalar('select user_primary_topic from public.classifications where user_id=$1',[owner]),'USER EDITED');
      assert.deepEqual((await db.query('select id,evidence_text from public.action_sources where user_id=$1',[owner])).rows,sources);
      assert.equal(await scalar('select processing_status from public.items where id=$1',[id(1)]),'indexing');
      assert.equal(await scalar('select count(*)::int from public.actions where user_id=$1',[owner]),1);
    });
    await t.test('expired Worker lease can be recovered and old token cannot write',async()=>{
      await seed(4);const old=await claim();
      await db.query("update private.gmail_analysis_jobs set lease_until=now()-interval '1 second' where item_id=$1",[id(4)]);
      j=await claim();assert.notEqual(j.token,old.token);assert.equal(j.attempt,2);
      await assert.rejects(()=>finish(old,validator.validateAnalysis(fixture(),content)),/Stale attempt/);
      assert.equal((await finish(j,null,'GEMINI_HTTP_401',null)).state,'failed');assert.equal(await claim(),null);
    });
    await t.test('source changes cancel old generation; status updates never enqueue again',async()=>{
      await seed(5);const old=await claim();await db.query('update public.items set content_text=$2 where id=$1',[id(5),content+' changed']);
      await assert.rejects(()=>finish(old,validator.validateAnalysis(fixture(),content)),/Stale attempt/);
      j=await claim();assert.equal(j.attempt,1);await finish(j,null,'ANALYSIS_VALIDATION_FAILED',null);
      await db.query("update public.items set processing_status='queued' where id=$1",[id(5)]);assert.equal(await claim(),null);
    });
    await t.test('five crashed attempts terminate and clear analyzing status',async()=>{
      await seed(6);
      for(let n=1;n<=5;n++){j=await claim();assert.equal(j.attempt,n);await db.query("update private.gmail_analysis_jobs set lease_until=now()-interval '1 second' where item_id=$1",[id(6)]);}
      assert.equal(await claim(),null);assert.equal(await scalar('select state from private.gmail_analysis_jobs where item_id=$1',[id(6)]),'failed');
      assert.equal(await scalar('select processing_status from public.items where id=$1',[id(6)]),'failed');
    });
    await t.test('metadata/title snapshot change cannot store an obsolete result',async()=>{
      await seed(7);const old=await claim();
      // PGlite's test clock can return the same millisecond for separate transactions.
      // This case verifies the changed-snapshot fence, so ensure its prerequisite.
      await new Promise(resolve=>setTimeout(resolve,10));
      await db.query("update public.items set title='Changed TEST title' where id=$1",[id(7)]);
      assert.equal((await finish(old,validator.validateAnalysis(fixture(),content))).stale,true);
      j=await claim();assert.equal(j.itemId,id(7));await finish(j,null,'GEMINI_HTTP_400',null);
      assert.equal(await scalar('select count(*)::int from public.actions where user_id=$1',[owner]),1);
    });
    await t.test('browser cannot claim/finish/read jobs or enqueue another owner',async()=>{
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec("select set_config('request.jwt.claim.role','authenticated',false);set role authenticated");
      await assert.rejects(()=>scalar('select public.enqueue_gmail_analysis($1,$2::uuid[])',[owner,[id(1)]]),/Forbidden/);
      await assert.rejects(()=>claim(),/permission denied/);await assert.rejects(()=>finish({userId:owner,itemId:id(1),token:id(2)}),/permission denied/);
      await assert.rejects(()=>db.query('select * from private.gmail_analysis_jobs'),/permission denied/);await db.exec('reset role');
    });
    await t.test('service role can invoke RPC but has no direct queue access; anon cannot enqueue',async()=>{
      await db.exec("select set_config('request.jwt.claim.role','service_role',false);set role service_role");
      assert.equal(await scalar('select public.claim_gmail_analysis_job($1::uuid[])',[[other]]) !== null,true);
      await assert.rejects(()=>db.query('select * from private.gmail_analysis_jobs'),/permission denied/);
      await db.exec('reset role;set role anon');
      await assert.rejects(()=>scalar('select public.enqueue_gmail_analysis($1,$2::uuid[])',[owner,[id(1)]]),/permission denied/);
      await db.exec('reset role');
    });
    await t.test('free demo reserves globally, honors exact ITEM scope, cooldown and daily budget',async()=>{
      await seed(8);await seed(9);
      const freeClaim=()=>scalar('select public.claim_free_gmail_analysis_job($1::uuid[],$2::uuid[])',[[owner],[id(9)]]);
      const picked=await freeClaim();assert.equal(picked.itemId,id(9));
      assert.equal(await scalar('select reserved from private.gmail_free_budget'),1);
      assert.equal(await freeClaim(),null);
      await db.exec("update private.gmail_free_budget set next_at=now()-interval '1 second',reserved=5");
      assert.equal(await freeClaim(),null);
      assert.equal(await scalar('select attempts from private.gmail_analysis_jobs where item_id=$1',[id(8)]),0);
      await db.exec('set role authenticated');
      await assert.rejects(()=>freeClaim(),/permission denied/);await db.exec('reset role');
    });
  } finally {await db.close();}
});

test('compiled Cloud Run HTTP entrypoint starts and fails closed without an approved owner scope',async()=>{
  execFileSync(process.execPath,['scripts/build-analysis-worker.mjs'],{stdio:'pipe'});
  const child=spawn(process.execPath,['--conditions=react-server','-e',`const {server}=require('./.analysis-worker/workers/analysis/server.cjs');server.on('listening',()=>console.log(server.address().port));`],{
    env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,PORT:'0',NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic-only',GMAIL_ANALYSIS_WORKER_ENABLED:'true'},stdio:['ignore','pipe','pipe'],
  });
  let text='';
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('worker startup deadline')),10000);
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('worker exited'));});
      child.stdout.on('data',chunk=>{text+=chunk;if(/^\d+\s*$/.test(text)){clearTimeout(timer);resolve(Number(text.trim()));}});
    });
    const url=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(url+'/run',{signal:AbortSignal.timeout(5000)})).status,404);
    assert.equal((await fetch(url+'/run',{method:'POST',body:'{"user":"foreign"}',signal:AbortSignal.timeout(5000)})).status,400);
    const run=await fetch(url+'/run',{method:'POST',signal:AbortSignal.timeout(5000)});
    assert.equal(run.status,503);assert.deepEqual(await run.json(),{error:'WORKER_UNAVAILABLE'});
  }finally{child.kill();}
});

test('Worker runner uses shared provider, bounded claims, retry and stale persistence handling',async()=>{
  const calls=[];let generated=0,claims=0;
  const row={source:'gmail',format:'email',content_text:content,metadata:{}};
  const admin={from(){const q={select(){return q;},eq(){return q;},single:async()=>({data:row}),limit:async()=>({data:[]})};return q;}};
  const rpc={analysisJobRpc:async(_client,name,args)=>{
    calls.push({name,args}); if(name==='claim_gmail_analysis_job') return {data:claims++<2?{userId:owner,itemId:id(1),token:id(2),attempt:1}:null,error:null};
    return {data:{state:'retry'},error:claims===2?{code:'PT409'}:null};
  }};
  const runner=load('workers/analysis/runner.ts',{'@/lib/gemini/client':{...client,getGeminiConfig:()=>({model:'gemini-synthetic'}),analyzeGmailText:async()=>{generated++;throw new client.GeminiAnalysisError('GEMINI_UNAVAILABLE',503);}},
    '@/lib/gemini/validation':validator,'@/lib/items/analysis-policy':policy,'@/lib/items/analysis-failure':failure,'@/lib/items/analysis-job-rpc':rpc});
  const result=await runner.runAnalysisBatch(admin,[owner]);assert.equal(result.retry,1);assert.equal(result.stale,1);assert.equal(generated,2);
  assert.equal(calls.filter(c=>c.name==='finish_gmail_analysis_job').length,2);
  await assert.rejects(()=>runner.runAnalysisBatch(admin,[]),/OWNER_SCOPE/);
});

test('free runner uses exact scope and defers provider quota errors without immediate retry',async()=>{
  let claims=0,providerCalls=0,saved;
  const admin={from(){const q={select(){return q;},eq(){return q;},single:async()=>({data:{source:'gmail',format:'email',content_text:content,metadata:{}}}),limit:async()=>({data:[]})};return q;}};
  const runner=load('workers/analysis/runner.ts',{
    '@/lib/gemini/client':{getGeminiConfig:()=>({model:'gemini-synthetic'}),analyzeGmailText:async(_text,_topics,_context,version,options)=>{providerCalls++;assert.equal(version,'0.2');assert.equal(options.maxAttempts,1);throw new client.GeminiAnalysisError('GEMINI_UNAVAILABLE',429,undefined,71461);}},
    '@/lib/gemini/validation':validator,'@/lib/items/analysis-policy':policy,'@/lib/items/analysis-failure':failure,
    '@/lib/items/analysis-job-rpc':{analysisJobRpc:async(_admin,name,args)=>{
      if(name==='claim_free_gmail_analysis_job'){claims++;assert.deepEqual(Array.from(args.p_item_ids),[id(1)]);return {data:{userId:owner,itemId:id(1),token:id(2),attempt:1},error:null};}
      saved=args;return {data:{state:'retry'},error:null};
    }},
  });
  const result=await runner.runAnalysisBatch(admin,[owner],1,[id(1)]);
  assert.equal(result.retry,1);assert.equal(claims,1);assert.equal(providerCalls,1);assert.equal(saved.p_retry_seconds,71461);
});

test('automatic worker reuses a validated unchanged artifact across model changes and preserves provenance',async()=>{
  const originalModel='gemini-original', configuredModel='gemini-new';let saved;
  const row={source:'gmail',format:'email',content_text:content,metadata:{aiAnalysis:{schemaVersion:'0.2',model:originalModel,inputFingerprint:policy.analysisFingerprint(content,originalModel,'0.2'),result:fixture()}}};
  const admin={from(){const q={select(){return q;},eq(){return q;},single:async()=>({data:row}),limit:async()=>({data:[]})};return q;}};
  const runner=load('workers/analysis/runner.ts',{
    '@/lib/gemini/client':{getGeminiConfig:()=>({model:configuredModel}),analyzeGmailText:()=>{throw new Error('UNNECESSARY_PROVIDER_CALL');}},
    '@/lib/gemini/validation':validator,'@/lib/items/analysis-policy':policy,'@/lib/items/analysis-failure':failure,
    '@/lib/items/analysis-job-rpc':{analysisJobRpc:async(_admin,name,args)=>{
      if(name==='claim_free_gmail_analysis_job')return {data:{userId:owner,itemId:id(1),token:id(2),attempt:1},error:null};
      saved=args;return {data:{state:'complete'},error:null};
    }},
  });
  const result=await runner.runAnalysisBatch(admin,[owner],1,[id(1)]);
  assert.equal(result.complete,1);assert.equal(saved.p_model,originalModel);
  assert.equal(saved.p_fingerprint,policy.analysisFingerprint(content,originalModel,'0.2'));
});
