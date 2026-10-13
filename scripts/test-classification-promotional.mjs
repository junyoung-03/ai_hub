import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {noiseDb,gmailOnlyMigrationPath} from './noise-db.mjs';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
import {quote,none,fixture,content} from './analysis-fixtures.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const id=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const policy=load('src/lib/items/analysis-policy.ts');
const validator=load('src/lib/gemini/validation.ts');
const model='gemini-synthetic';
function output(text,verdict='promotional',signals=[]){return {schemaVersion:'0.3',classification:{primaryTopic:'일반',documentType:'general',tags:[]},actions:[],eventObservations:[],noiseAssessment:{verdict,confidence:null,evidence:verdict==='promotional'?[quote(text)]:[],reasons:[verdict==='normal'?'non_promotional':verdict==='uncertain'?'insufficient_context':'general_promotion'],protectionSignals:signals.map(reason=>({reason,evidence:quote(text)}))}};}

test('Gmail-only policy and conservative normalization run against isolated real SQL',async t=>{
 const db=await noiseDb();
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const state=n=>scalar('select public.item_noise_state(i) from public.items i where id=$1',[id(n)]);
 async function seed(n,text,v=output(text),source='gmail',format='email'){
  const google=['gmail','drive','calendar'].includes(source);
  await db.query('insert into public.items(id,user_id,connection_id,external_id,external_container_id,source,format,storage_path,title,content_text,processing_status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,\'queued\')',[id(n),owner,google?owner:null,google?id(n):null,source==='calendar'?'primary':null,source,format,source==='upload'?'synthetic/test':null,text]);
  if(v)await persist(n,text,v);
 }
 async function persist(n,text,v){
  const value=validator.validateAnalysis(v,text);
  const source=await scalar('select source from public.items where id=$1',[id(n)]);
  const fn=source==='gmail'?'persist_gmail_item_analysis':'persist_eligible_item_analysis';
  return scalar(`select public.${fn}($1,$2,$3,null,$4::jsonb,$5,$6)`,[owner,id(n),text,JSON.stringify(value),model,policy.analysisFingerprint(text,model,value.schemaVersion)]);
 }
 try{
  await db.exec(`create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;`);
  await db.query('insert into auth.users(id) values($1)',[owner]);
  await db.query('insert into public.connections(id,user_id) values($1,$1)',[owner]);
  await seed(1,'순수 할인 쿠폰 안내');
  await db.query("update public.classifications set ai_primary_topic='일반',ai_document_type='contract',ai_tags='{계약서}' where item_id=$1",[id(1)]);
  await seed(2,'사용자 수정 자료');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await scalar("select public.set_classification_override($1,'사용자 주제','general','{}')",[id(2)]);
  await db.query("update public.classifications set ai_primary_topic='일반',ai_document_type='contract' where item_id=$1",[id(2)]);
  const before=(await db.query('select id,metadata,content_text from public.items order by id')).rows;
  await db.exec(readFileSync('supabase/migrations/20261013030716_gmail_analysis_worker_queue.sql','utf8'));
  const searchBefore=await scalar("select prosrc from pg_proc where oid='public.search_candidates_promotional(uuid,text,text,extensions.vector,jsonb,jsonb)'::regprocedure");
  await db.exec(readFileSync(gmailOnlyMigrationPath,'utf8'));
  await t.test('clear general classifications normalize; weak, conflicting and specific topics stay',async()=>{
   for(const [topic,type,tags,expected] of [
    ['일반','contract',[],'계약·행정'],['일반','general',['동의서'],'계약·행정'],
    ['일반','billing',[],'결제·금융'],['일반','notice',['청구서'],'결제·금융'],
    ['일반','schedule',[],'일정·행사'],['일반','notice',['면접 일정'],'일정·행사'],
    ['일반','notice',['카드'],'일반'],['일반','notice',['갱신'],'일반'],
    ['일반','general',['계약서','청구서'],'일반'],['일반','general',[],'일반'],
    ['보안 알림','contract',['계약서'],'보안 알림']])
    assert.equal(await scalar('select public.normalize_ai_topic($1,$2,$3::text[])',[topic,type,tags]),expected);
   assert.equal(await scalar('select ai_primary_topic from public.classifications where item_id=$1',[id(1)]),'계약·행정');
   assert.equal(await scalar('select ai_primary_topic from public.classifications where item_id=$1',[id(2)]),'일반');
   assert.deepEqual((await db.query('select id,metadata,content_text from public.items order by id')).rows,before);
  });
  await t.test('user overrides including empty tags survive subsequent AI updates',async()=>{
   const candidate=output('사용자 수정 자료');candidate.classification.documentType='contract';
   await persist(2,'사용자 수정 자료',candidate);
   const row=(await db.query('select ai_primary_topic,user_primary_topic,user_tags from public.classifications where item_id=$1',[id(2)])).rows[0];
   assert.equal(row.user_primary_topic,'사용자 주제');assert.deepEqual(row.user_tags,[]);
   assert.equal(row.ai_primary_topic,'일반');
  });
  await t.test('pure Gmail promotion hides; include toggle restores before ranking/limits',async()=>{
   await seed(3,'순수 광고 상품 할인 쿠폰');assert.equal((await state(3)).effectiveVisibility,'HIDE');
   for(const include of [false,true]){
    assert.equal(await scalar(`select count(*)::int from public.items i where i.id=$1 and ($2 or public.item_is_visible(i))`,[id(3),include]),include?1:0);
    const results=await scalar(`select public.search_candidates_promotional($1,'unused','쿠폰',null,$2::jsonb,'{"kind":"documents"}')`,[owner,JSON.stringify({source:[],format:[],includePromotional:include})]);
    assert.equal(results.some(r=>r.itemId===id(3)),include);
   }
   assert.equal(await scalar("select prosrc from pg_proc where oid='public.search_candidates_promotional(uuid,text,text,extensions.vector,jsonb,jsonb)'::regprocedure"),searchBefore);
  });
  await t.test('Event, Action and Deadline protect promotional Gmail with Source/Evidence intact',async()=>{
   const text='2026년 10월 24일 행사 안내',event=output(text);event.eventObservations=[{status:'confirmed',date:'2026-10-24',datetime:null,rawText:'2026년 10월 24일',evidence:quote(text)}];
   await seed(4,text,event);assert.equal((await state(4)).effectiveVisibility,'SHOW');
   for(const [n,deadline] of [[5,false],[6,true]]){
    const text='2026년 10월 24일까지 자료 제출',v=output(text);
    v.actions=[{title:'자료 제출',actionType:'required',requirements:[],conditions:[],startObservation:none(),deadlineObservation:deadline?{status:'confirmed',date:'2026-10-24',datetime:null,rawText:'2026년 10월 24일',evidence:quote(text)}:none(),evidence:[quote(text)]}];
    await seed(n,text,v);const s=await state(n);assert.equal(s.effectiveVisibility,'SHOW');assert.ok(s.protectionState.includes('action_exists'));if(deadline)assert.ok(s.protectionState.includes('deadline_exists'));
    const evidence=await db.query('select * from public.action_sources where item_id=$1',[id(n)]);
    assert.equal(evidence.rows.length,1);assert.equal(evidence.rows[0].evidence_text,text);
    await state(n);assert.deepEqual((await db.query('select * from public.action_sources where item_id=$1',[id(n)])).rows,evidence.rows);
   }
  });
  await t.test('payment, billing, contract, security, account and outage protect Gmail',async()=>{
   for(const [offset,reason] of ['payment','billing','contract','security','account','service_outage'].entries()){
    const n=10+offset,text=`중요 안내 ${reason}`;await seed(n,text,output(text,'promotional',[reason]));assert.equal((await state(n)).effectiveVisibility,'SHOW');
   }
   for(const [n,type,topic] of [[20,'billing','일반'],[21,'contract','일반'],[22,'notice','계정 보안'],[23,'notice','서비스 장애']]){
    const text='중요 자료 안내';await seed(n,text);await db.query('update public.classifications set ai_document_type=$2,ai_primary_topic=$3 where item_id=$1',[id(n),type,topic]);assert.equal((await state(n)).effectiveVisibility,'SHOW');
   }
  });
  await t.test('absent, legacy, uncertain, failed and invalid assessments fail open',async()=>{
   await seed(30,'미분석',null);assert.equal((await state(30)).effectiveVisibility,'SHOW');
   const text='기존 성공 자료',legacy={...output(text),schemaVersion:'0.2'};delete legacy.noiseAssessment;
   await seed(31,text,legacy);assert.equal((await state(31)).effectiveVisibility,'SHOW');
   await seed(32,'애매한 자료',output('애매한 자료','uncertain'));assert.equal((await state(32)).effectiveVisibility,'SHOW');
   await db.query("update public.items set processing_status='failed' where id=$1",[id(3)]);assert.equal((await state(3)).effectiveVisibility,'SHOW');
   await seed(33,'원문',null);const bad=output('원문');bad.noiseAssessment.evidence=[quote('없는 인용')];await assert.rejects(()=>persist(33,'원문',bad));assert.equal((await state(33)).effectiveVisibility,'SHOW');
  });
  await t.test('every non-Gmail source stays visible even with historical force_promotional',async()=>{
   for(const [offset,[source,format]] of [['upload','pdf'],['upload','image'],['manual','text'],['drive','document'],['calendar','calendar_event']].entries()){
    const n=40+offset,text='기존 광고 판정 자료';await seed(n,text,output(text));
    await scalar("select public.set_noise_override($1,'force_promotional')",[id(n)]);
    const google=['drive','calendar'].includes(source);
    await db.query('update public.items set source=$2,format=$3,connection_id=$4,external_id=$5,external_container_id=$6,storage_path=$7 where id=$1',[id(n),source,format,google?owner:null,google?id(n):null,source==='calendar'?'primary':null,source==='upload'?'synthetic/test':null]);
    const current=await state(n);assert.equal(current.effectiveVisibility,'SHOW');assert.equal(current.aiVerdict,null);
    await assert.rejects(()=>scalar("select public.set_noise_override($1,'force_promotional')",[id(n)]),e=>e.code==='22023');
    for(const include of [false,true]){
     assert.equal(await scalar('select count(*)::int from public.items i where i.id=$1 and ($2 or public.item_is_visible(i))',[id(n),include]),1);
     const results=await scalar(`select public.search_candidates_promotional($1,'unused','광고',null,$2::jsonb,'{"kind":"documents"}')`,[owner,JSON.stringify({source:[],format:[],includePromotional:include})]);
     assert.equal(results.some(r=>r.itemId===id(n)),true);
    }
   }
  });
  await t.test('non-Gmail fresh persistence discards noise and preserves ordinary analysis',async()=>{
   const text='직접 입력 안내';await seed(50,text,null,'manual','text');await persist(50,text,output(text));
   assert.equal(await scalar('select count(*)::int from public.item_noise_assessments where item_id=$1',[id(50)]),0);
   assert.equal(await scalar("select metadata#>>'{aiAnalysis,schemaVersion}' from public.items where id=$1",[id(50)]),'0.2');
  });
  await t.test('new capability is owner-readable, no anon and no direct noise DML grants',async()=>{
   await db.exec('set role authenticated');assert.equal(await scalar('select public.gmail_promotional_ready()'),true);
   await assert.rejects(()=>db.query("update public.item_noise_assessments set ai_verdict='normal'"),e=>e.code==='42501');
   await db.exec('reset role;set role anon');await assert.rejects(()=>scalar('select public.gmail_promotional_ready()'),e=>e.code==='42501');await db.exec('reset role');
  });
  await t.test('fenced worker finish persists a single v0.3 Gmail result with its assessment',async()=>{
   const other=id(90),item=id(91),text='순수 할인 쿠폰 안내';
   await db.query('insert into auth.users(id) values($1)',[other]);await db.query('insert into public.connections(id,user_id) values($1,$1)',[other]);
   await db.query("insert into public.items(id,user_id,connection_id,external_id,source,format,title,content_text,processing_status) values($1,$2,$2,'new-gmail','gmail','email',$3,$3,'queued')",[item,other,text]);
   const job=await scalar('select public.claim_gmail_analysis_job($1::uuid[])',[[other]]);
   const result=validator.validateAnalysis(output(text),text);
   await scalar('select public.finish_gmail_analysis_job($1,$2,$3,$4::jsonb,$5,$6,null,null)',[other,item,job.token,JSON.stringify(result),model,policy.analysisFingerprint(text,model,'0.3')]);
   assert.equal(await scalar('select ai_verdict from public.item_noise_assessments where item_id=$1',[item]),'promotional');
   assert.equal(await scalar('select public.item_is_visible(i) from public.items i where id=$1',[item]),false);
   assert.equal(await scalar('select state from private.gmail_analysis_jobs where item_id=$1',[item]),'complete');
  });
 }finally{await db.close();}
});

test('noise-enabled worker makes one combined request for new Gmail and no request for existing success',async()=>{
 for(const version of [null,'0.2','0.3']){
  let calls=0,saved;
  const result=version==='0.3'?{...fixture(),schemaVersion:'0.3',noiseAssessment:output(content,'normal').noiseAssessment}:fixture();
  const row={source:'gmail',format:'email',content_text:content,metadata:version?{aiAnalysis:{schemaVersion:version,model:'gemini-old',inputFingerprint:policy.analysisFingerprint(content,'gemini-old',version),result}}:{}};
  const admin={rpc:name=>{assert.equal(name,'gmail_promotional_ready');return {abortSignal:async()=>({data:true})};},from(){const q={select(){return q;},eq(){return q;},single:async()=>({data:row}),limit:async()=>({data:[]})};return q;}};
  const runner=load('workers/analysis/runner.ts',{'@/lib/gemini/client':{getGeminiConfig:()=>({model:'gemini-new'}),analyzeGmailText:async(_text,_topics,_context,version)=>{calls++;assert.equal(version,'0.3');return {...fixture(),schemaVersion:'0.3',noiseAssessment:output(content,'normal').noiseAssessment};}},'@/lib/gemini/validation':validator,'@/lib/items/analysis-job-rpc':{analysisJobRpc:async(_admin,name,args)=>{if(name==='claim_free_gmail_analysis_job')return {data:{userId:owner,itemId:id(1),token:id(2),attempt:1}};saved=args;return {data:{state:'complete'}};}}},{process:{env:{PROMOTIONAL_NOISE_ENABLED:'true'}}});
  assert.equal((await runner.runAnalysisBatch(admin,[owner],1,[id(1)])).complete,1);
  assert.equal(calls,version?0:1);assert.equal(saved.p_model,version?'gemini-old':'gemini-new');
  assert.equal(saved.p_analysis.schemaVersion,version??'0.3');
 }
});

test('explicit Gmail analysis reuses successful v0.2 when noise is enabled and the configured model changes',async()=>{
 const original='gemini-old',row={id:id(1),source:'gmail',format:'email',content_text:content,content_hash:null,processing_status:'completed',updated_at:'revision',metadata:{aiAnalysis:{schemaVersion:'0.2',model:original,inputFingerprint:policy.analysisFingerprint(content,original,'0.2'),result:fixture()}}};
 const read={select(){return read;},eq(){return read;},maybeSingle:async()=>({data:row})};
 const analysis=load('src/lib/items/analysis.ts',{'@/lib/items/promotional-gate':{promotionalReady:async()=>true},'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/server':{createClient:async()=>({from:()=>read})},'@/lib/supabase/admin':{createAdminClient:()=>assert.fail('cached Gmail must not write')},'@/lib/items/filters':{isItemId:()=>true},'@/lib/gemini/client':{getGeminiConfig:()=>({model:'gemini-new'}),analyzeGmailText:()=>assert.fail('no additional Gemini call')},'@/lib/gemini/validation':validator},{process:{env:{}}});
 assert.equal((await analysis.analyzeOwnedItem(id(1))).cached,true);
});

test('fresh non-Gmail analysis keeps v0.2 with no separate noise request',async()=>{
 for(const [source,format] of [['upload','pdf'],['upload','image'],['manual','text'],['drive','document']]){
  let providerCalls=0,saved;
  const row={id:id(1),source,format,content_text:content,content_hash:null,processing_status:'queued',updated_at:'revision',metadata:{upload:{extraction:{status:'complete',version:'upload-text-v1'}}}};
  const read={select(){return read;},eq(){return read;},maybeSingle:async()=>({data:row}),limit:async()=>({data:[]})};
  const claim={update(){return claim;},eq(){return claim;},select(){return claim;},maybeSingle:async()=>({data:{updated_at:'claimed'}})};
  const analysis=load('src/lib/items/analysis.ts',{'@/lib/items/promotional-gate':{promotionalReady:async()=>true},'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/server':{createClient:async()=>({from:()=>read})},'@/lib/supabase/admin':{createAdminClient:()=>({from:()=>claim,rpc:async(_name,args)=>{saved=args;return {data:{cached:false,action_count:1,created_count:1,reused_count:0}};}})},'@/lib/items/filters':{isItemId:()=>true},'@/lib/gemini/client':{getGeminiConfig:()=>({model}),analyzeGmailText:async(_text,_topics,_context,version)=>{providerCalls++;assert.equal(version,'0.2');return fixture();}},'@/lib/gemini/validation':validator},{process:{env:{}}});
  await analysis.analyzeOwnedItem(id(1));assert.equal(providerCalls,1);assert.equal(saved.p_analysis.noiseAssessment,undefined);
 }
});

test('non-Gmail noise API is blocked before any override RPC',async()=>{
 class ItemWriteError extends Error{constructor(code,status){super(code);this.status=status;}}
 for(const source of ['upload','manual','drive','calendar']){
  const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{source},error:null})};
  const api=load('src/lib/items/noise.ts',{'@/lib/items/promotional-gate':{promotionalReady:async()=>true},'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/server':{createClient:async()=>({from:()=>q,rpc:()=>assert.fail('non-Gmail override RPC')})},'@/lib/items/filters':{isItemId:()=>true},'@/lib/items/writes':{ItemWriteError}});
  await assert.rejects(()=>api.noiseState(id(1),{userOverride:'force_promotional'}),e=>e.status===404);
 }
});
