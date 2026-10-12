import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {noiseDb} from './noise-db.mjs';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
import {quote,none} from './analysis-fixtures.mjs';
const validate=load('src/lib/gemini/validation.ts').validateAnalysis;
const policy=load('src/lib/items/analysis-policy.ts');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model='gemini-synthetic';
export function output(text,verdict='promotional',signals=[]){return {schemaVersion:'0.3',classification:{primaryTopic:'자료',documentType:'general',tags:[]},actions:[],eventObservations:[],noiseAssessment:{verdict,confidence:null,evidence:verdict==='promotional'?[quote(text)]:[],reasons:[verdict==='normal'?'non_promotional':verdict==='uncertain'?'insufficient_context':'general_promotion'],protectionSignals:signals.map(reason=>({reason,evidence:quote(text)}))}};}

test('promotional SQL migration, A-H, RLS, overrides, stale evidence, snapshots and candidate limits',async t=>{
 const db=await noiseDb();
 const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
 const state=n=>scalar('select public.item_noise_state(i) from public.items i where id=$1',[id(n)]);
 async function seed(n,text,v=output(text),user=owner){
  await db.query("insert into public.items(id,user_id,source,format,title,content_text,processing_status) values($1,$2,'manual','text',$3,$3,'queued')",[id(n),user,text]);
  if(v) await persist(n,text,v,user);
 }
 async function persist(n,text,v,user=owner,fingerprint=policy.analysisFingerprint(text,model)){
  const value=validate(v,text,{source:'manual',referenceDate:'2026-10-12',timezone:'Asia/Seoul',basis:'created_at'});
  await db.exec('set role service_role');
  try{return await scalar('select public.persist_eligible_item_analysis($1,$2,$3,null,$4::jsonb,$5,$6)',[user,id(n),text,JSON.stringify(value),model,fingerprint]);}
  finally{await db.exec('reset role');}
 }
 async function override(n,value,user=owner){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');
  try{return await scalar('select public.set_noise_override($1,$2)',[id(n),value]);}finally{await db.exec('reset role');}
 }
 const event=text=>({status:'needs_review',date:null,datetime:null,rawText:'10월 24일',evidence:quote(text)});
 try{
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
  await t.test('A payment SHOW',async()=>{await seed(1,'10월 카드 결제 예정금액 안내',output('10월 카드 결제 예정금액 안내','normal',['payment']));assert.equal((await state(1)).effectiveVisibility,'SHOW');});
  await t.test('B cashback promotional HIDE',async()=>{await seed(2,'신한카드 고객님 10% 캐시백 이벤트');assert.equal((await state(2)).effectiveVisibility,'HIDE');});
  await t.test('C promotional event SHOW without rewriting verdict',async()=>{const text='10월 24일 채용박람회 참가 안내',v=output(text);v.eventObservations=[event(text)];await seed(3,text,v);const s=await state(3);assert.equal(s.aiVerdict,'promotional');assert.equal(s.effectiveVisibility,'SHOW');assert.ok(s.protectionState.includes('event_exists'));});
  await t.test('D contract Action/Deadline SHOW',async()=>{const text='계약 갱신 안내 — 2026년 10월 30일까지 확인',v=output(text,'promotional',['contract']);v.actions=[{title:'계약 갱신 확인',actionType:'required',requirements:[],conditions:[],startObservation:none(),deadlineObservation:{status:'confirmed',date:'2026-10-30',datetime:null,rawText:'2026년 10월 30일',evidence:quote(text)},evidence:[quote(text)]}];await seed(4,text,v);assert.equal((await state(4)).effectiveVisibility,'SHOW');});
  await t.test('E clear sale HIDE',async()=>{await seed(5,'신제품 출시 50% 할인');assert.equal((await state(5)).effectiveVisibility,'HIDE');});
  await t.test('F security protection SHOW even if promotional',async()=>{await seed(6,'보안 정책 변경 안내',output('보안 정책 변경 안내','promotional',['security']));assert.equal((await state(6)).effectiveVisibility,'SHOW');});
  await t.test('G force_show wins and survives AI reanalysis',async()=>{await override(2,'force_show');await db.exec('set role authenticated');await db.query("select public.set_classification_override($1,'직접 분류','general','{}')",[id(2)]);await db.exec('reset role');await persist(2,'신한카드 고객님 10% 캐시백 이벤트',output('신한카드 고객님 10% 캐시백 이벤트'));assert.equal((await db.query('select user_primary_topic,user_tags from public.classifications where item_id=$1',[id(2)])).rows[0].user_primary_topic,'직접 분류');assert.deepEqual((await db.query('select user_tags from public.classifications where item_id=$1',[id(2)])).rows[0].user_tags,[]);assert.equal((await state(2)).userOverride,'force_show');assert.equal((await state(2)).effectiveVisibility,'SHOW');});
  await t.test('H force_promotional hides normal; reset restores policy',async()=>{await override(1,'force_promotional');assert.equal((await state(1)).effectiveVisibility,'HIDE');await override(1,null);assert.equal((await state(1)).effectiveVisibility,'SHOW');});
  await t.test('v0.2, unanalysed, failed, stale and uncertain fail open',async()=>{
   await seed(7,'legacy',null);assert.equal((await state(7)).effectiveVisibility,'SHOW');
   const legacy={...output('legacy'),schemaVersion:'0.2'};delete legacy.noiseAssessment;await persist(7,'legacy',legacy);assert.equal((await state(7)).effectiveVisibility,'SHOW');
   await seed(8,'unclear',output('unclear','uncertain'));assert.equal((await state(8)).effectiveVisibility,'SHOW');
   await db.query("update public.items set processing_status='failed' where id=$1",[id(5)]);assert.equal((await state(5)).effectiveVisibility,'SHOW');
   await db.query("update public.items set content_text='changed',processing_status='completed' where id=$1",[id(5)]);assert.equal((await state(5)).effectiveVisibility,'SHOW');
  });
  await t.test('forged noise quote fails atomically; stale fingerprint rejected',async()=>{
   const text='広告ではない原文',bad=output(text);bad.noiseAssessment.evidence=[quote('invented')];await seed(9,text,null);
   await assert.rejects(()=>persist(9,text,bad));assert.equal(await scalar('select count(*)::int from public.item_noise_assessments where item_id=$1',[id(9)]),0);
   const valid=validate(output(text),text);valid.noiseAssessment.evidence[0].text='forged';
   await assert.rejects(()=>db.query('select public.persist_eligible_item_analysis($1,$2,$3,null,$4::jsonb,$5,$6)',[owner,id(9),text,JSON.stringify(valid),model,policy.analysisFingerprint(text,model)]),e=>e.code==='22023');
   await assert.rejects(()=>persist(9,text,output(text),owner,'0'.repeat(64)),e=>e.code==='PT409');
   assert.equal((await state(9)).effectiveVisibility,'SHOW');
  });
  await t.test('Event addition/removal, unresolved Event, Calendar and Action history protect current data',async()=>{
   await override(2,null);assert.equal((await state(2)).effectiveVisibility,'HIDE');
   await db.query("update public.items set metadata=jsonb_set(metadata,'{aiAnalysis,result,eventObservations}',$2::jsonb) where id=$1",[id(2),JSON.stringify([event('10월 24일')])]);assert.equal((await state(2)).effectiveVisibility,'SHOW');
   await db.query("update public.items set metadata=jsonb_set(metadata,'{aiAnalysis,result,eventObservations}','[]') where id=$1",[id(2)]);assert.equal((await state(2)).effectiveVisibility,'HIDE');
   await override(3,'force_promotional');assert.equal((await state(3)).effectiveVisibility,'HIDE');assert.equal(await scalar("select jsonb_array_length(metadata#>'{aiAnalysis,result,eventObservations}') from public.items where id=$1",[id(3)]),1);
   await db.query("update public.actions set status='completed',completed_at=now() where id in (select action_id from public.action_sources where item_id=$1)",[id(4)]);assert.ok((await state(4)).protectionState.includes('action_exists'));
   // Calendar synthetic row must obey the actual Unified ITEM FK/identity rules.
   await db.query("insert into public.connections(id,user_id) values($1,$2)",[id(70),owner]);
   await db.query("update public.items set source='calendar',format='calendar_event',connection_id=$2,external_id='e',external_container_id='c' where id=$1",[id(7),id(70)]);assert.ok((await state(7)).protectionState.includes('event_exists'));
  });
  await t.test('RLS own SELECT, no authenticated DML, foreign override/ownership blocked',async()=>{
   await seed(10,'other owner',output('other owner'),other);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');
   assert.equal(await scalar('select count(*)::int from public.item_noise_assessments'),1);
   await assert.rejects(()=>db.query("update public.item_noise_assessments set ai_verdict='normal'"),e=>e.code==='42501');
   await assert.rejects(()=>db.query('delete from public.item_noise_assessments'),e=>e.code==='42501');
   assert.equal((await scalar('select public.get_item_noise_state($1)',[id(10)])).aiVerdict,'promotional');
   await assert.rejects(()=>db.query('select public.get_item_noise_state($1)',[id(2)]),e=>e.code==='P0002');
   await db.exec('reset role');await db.exec('set role anon');
   await assert.rejects(()=>db.query('select public.set_noise_override($1,null)',[id(2)]),e=>e.code==='42501');await db.exec('reset role');
   await assert.rejects(()=>override(2,'force_show',other),e=>e.code==='P0002');
   await assert.rejects(()=>persist(2,'신한카드 고객님 10% 캐시백 이벤트',output('신한카드 고객님 10% 캐시백 이벤트'),other),e=>e.code==='P0002');
   await assert.rejects(()=>db.query('insert into public.item_noise_assessments(item_id,user_id) values($1,$2)',[id(9),other]),e=>e.code==='23503');
  });
  await t.test('historical Action Source protects; force_promotional retains Action search and does not reindex',async()=>{
   const action=await scalar('select action_id from public.action_sources where item_id=$1 and is_current',[id(4)]);
   await db.query('insert into public.action_sources(id,user_id,item_id,action_id,evidence_text,is_current) values($1,$2,$3,$4,$5,false)',[id(230),owner,id(2),action,'신한카드 고객님 10% 캐시백 이벤트']);
   assert.ok((await state(2)).protectionState.includes('action_exists'));assert.equal((await state(2)).effectiveVisibility,'SHOW');
   await db.query('delete from public.action_sources where id=$1',[id(230)]);assert.equal((await state(2)).effectiveVisibility,'HIDE');
   const index=await db.query('select * from private.search_index_jobs where item_id=$1',[id(4)]);
   await db.query("update public.actions set status='open',completed_at=null where id=$1",[action]);await override(4,'force_promotional');
   const results=await scalar("select public.search_candidates_promotional($1,'unused','해야 할 일',null,'{\"promotionalEnabled\":true,\"source\":[],\"format\":[]}', '{\"kind\":\"actions\"}')",[owner]);assert.ok(results.some(r=>r.actionId===action));
   assert.deepEqual((await db.query('select * from private.search_index_jobs where item_id=$1',[id(4)])).rows,index.rows);
   await override(4,null);
  });
  await t.test('snapshot created after concurrent hide cannot leak a stale default result; ON allows it',async()=>{
   const stamp=await scalar('select updated_at::text from public.items where id=$1',[id(2)]);
   const rows=[{kind:'item',itemId:id(2),snapshotUpdatedAt:stamp}];
   for(const includePromotional of [false,true]){
    const saved=await scalar("select public.search_runtime('snapshot',$1,$2::jsonb)",[owner,JSON.stringify({context:'race',version:'unused',results:rows,info:{promotionalEnabled:true,intent:'documents',appliedFilters:{includePromotional}}})]);
    const page=()=>scalar("select public.search_runtime('page',$1,$2::jsonb)",[owner,JSON.stringify({session:saved.id,context:'race',version:'unused',offset:0,limit:20})]);
    if(includePromotional)assert.equal((await page()).results.length,1);else await assert.rejects(page,e=>e.code==='P0002');
   }
  });
  await t.test('Library/Home pre-limit policy, Search pre-candidate limits, ON restores and snapshots invalidate',async()=>{
   for(let n=20;n<125;n++)await seed(n,'상품 할인 판촉 '+n);
   await seed(125,'상품 할인 보호 자료',output('상품 할인 보호 자료','normal'));
   const query=include=>scalar("select public.search_candidates_promotional($1,'unused','상품',null,$2::jsonb,'{\"kind\":\"documents\"}'::jsonb)",[owner,JSON.stringify({promotionalEnabled:true,source:[],format:[],from:null,to:null,includePromotional:include})]);
   const off=await query(false),on=await query(true);assert.equal(off.length,1);assert.equal(off[0].itemId,id(125));assert.equal(on.length,100);
   const recent=await db.query('select id from public.items i where user_id=$1 and public.item_is_visible(i) order by created_at desc,id desc limit 3',[owner]);assert.equal(recent.rows.length,3);
   const snapshot=await scalar("select public.search_runtime('snapshot',$1,$2::jsonb)",[owner,JSON.stringify({context:'noise',version:'unused',results:[],info:{promotionalEnabled:true}})]);
   await override(20,'force_show');assert.equal(await scalar('select count(*)::int from private.search_sessions where id=$1',[snapshot.id]),0);
   const snapshot2=await scalar("select public.search_runtime('snapshot',$1,$2::jsonb)",[owner,JSON.stringify({context:'noise',version:'unused',results:[],info:{promotionalEnabled:true}})]);
   await db.query("update public.items set metadata=jsonb_set(metadata,'{aiAnalysis,result,eventObservations}',$2::jsonb) where id=$1",[id(21),JSON.stringify([event('10월 24일')])]);assert.equal(await scalar('select count(*)::int from private.search_sessions where id=$1',[snapshot2.id]),0);
  });
  await t.test('EXPLAIN ANALYZE Library/Home/Search on synthetic fixture only',async()=>{
   const source=await scalar("select prosrc from pg_proc where oid='public.search_candidates_promotional(uuid,text,text,extensions.vector,jsonb,jsonb)'::regprocedure");
   const inline=source.replaceAll('p_user_id',()=>'$1::uuid').replaceAll('p_version',()=>"'unused'").replaceAll('p_query',()=>"'상품'").replaceAll('p_vector',()=>'null::extensions.vector').replaceAll('p_filters',()=>'$2::jsonb').replaceAll('p_intent',()=>"'{\"kind\":\"documents\"}'::jsonb");
   const plans=[];
   for(const [name,limit] of [['Library',30],['Home',3],['Search',null]])for(const includePromotional of [true,false]){
    const q=limit?`select id from public.items i where user_id=$1 ${includePromotional?'':'and public.item_is_visible(i)'} order by created_at desc,id desc limit ${limit}`:inline;
    const args=limit?[owner]:[owner,JSON.stringify({source:[],format:[],includePromotional})];
    const plan=(await db.query('explain (analyze,buffers,format json) '+q,args)).rows[0]['QUERY PLAN'][0];
    const scans=[];const walk=n=>{if(n['Node Type'].includes('Scan'))scans.push({node:n['Node Type'],relation:n['Relation Name'],index:n['Index Name'],rows:n['Actual Rows']});for(const child of n.Plans??[])walk(child);};walk(plan.Plan);
    plans.push({name,includePromotional,executionMs:plan['Execution Time'],scans,plan});
    console.log('PERFORMANCE '+JSON.stringify({name,includePromotional,executionMs:plan['Execution Time'],scans}));
   }
   mkdirSync('supabase/.temp',{recursive:true});writeFileSync('supabase/.temp/noise-performance.json',JSON.stringify({engine:await scalar('select version()'),ownerItems:await scalar('select count(*)::int from public.items where user_id=$1',[owner]),scope:'synthetic isolated WASM PostgreSQL; not production latency',plans},null,2));
  });
 }finally{await db.close();}
});
