import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
import {uiLoader} from './content-ui-loader.mjs';
import {loadSearch} from './search-loader.mjs';
import {cases,reference} from './content-calendar-fixtures.mjs';
import {noiseDb,migrationPath} from './noise-db.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const itemId='22222222-2222-4222-8222-222222222222';
const validator=load('src/lib/gemini/validation.ts');
const noise={verdict:'normal',confidence:null,evidence:[],reasons:['non_promotional'],protectionSignals:[]};
const upgrade=v=>({...structuredClone(v),schemaVersion:'0.3',noiseAssessment:noise});
const plain=v=>JSON.parse(JSON.stringify(v));

function capability(flag,ready,fault){
 const calls=[];
 const client=createClient('https://synthetic.invalid','fixture',{auth:{persistSession:false},global:{fetch:async url=>{
  const u=new URL(url);calls.push(u);
  if(u.pathname.endsWith('/rpc/promotional_noise_ready'))return ready?Response.json(true):Response.json({code:'PGRST202'},{status:404});
  if(fault==='table'&&u.pathname.endsWith('/item_noise_assessments'))return Response.json({code:'PGRST205'},{status:404});
  if(fault==='visibility'&&u.searchParams.has('item_is_visible'))return Response.json({code:'42703'},{status:400});
  if(fault==='cache')return Response.json({code:'PGRST204'},{status:400});
  return Response.json([]);
 }}});
 const gate=load('src/lib/items/promotional-gate.ts',{'@/lib/supabase/server':{createClient:async()=>client}},{process:{env:flag===undefined?{}:{PROMOTIONAL_NOISE_ENABLED:flag}}});
 return {gate,calls};
}
const matrix=[['OLD DB + OFF','false',false,false],['NEW DB + OFF','false',true,false],['NEW DB + ON','true',true,true],['OLD DB + ON','true',false,false]];
for(const [name,flag,dbReady,enabled] of matrix)test(name+': Library, Home, Search and one-call AI use the gated contract',async()=>{
 const {gate,calls}=capability(flag,dbReady);assert.equal(await gate.promotionalReady(),enabled);
 const deps={'@/lib/items/promotional-gate':gate,'@/lib/supabase/auth':{requireUser:async()=>({id:owner}),getCurrentUser:async()=>({id:owner})}};
 const requests=[];
 const row={id:itemId,title:'자료',source:'manual',format:'text',processing_status:'completed',created_at:reference.created_at,source_created_at:null,classification:null};
 const client=createClient('https://synthetic.invalid','fixture',{auth:{persistSession:false},global:{fetch:async url=>{requests.push(new URL(url));return Response.json([row]);}}});
 const ui=uiLoader({...deps,'@/lib/supabase/server':{createClient:async()=>client}});
 const filters=ui('src/lib/items/filters.ts'),queries=ui('src/lib/items/queries.ts');
 assert.equal((await queries.listItems(filters.parseItemQuery(new URLSearchParams()))).items.length,1);
 assert.equal(requests[0].searchParams.has('item_is_visible'),enabled);
 const home=uiLoader({...deps,'@/lib/items/queries':queries,'@/lib/google/connections':{getGoogleConnectionSummary:async()=>null},'@/components/workspace/request-clock':{getWorkspaceClock:async()=>Date.parse(reference.created_at)},'@/components/shell/app-shell':{AppShell:({children})=>React.createElement('main',{},children)},'@/components/actions/schedule-workspace':{ScheduleWorkspace:()=>null}});
 const html=renderToStaticMarkup(await home('src/components/home/today-view.tsx').TodayView());
 assert.equal(html.includes('광고 포함'),false);assert.equal(html.includes('최근 추가된 자료'),false);assert.equal(requests.length,1); // Home no longer fetches a hidden recent library.
 const c=loadSearch('src/lib/search/contract.ts',{}, {process:{env:{SEARCH_CURSOR_SECRET:'synthetic-search-secret-at-least-32-characters'}}});
 let candidate,snapshot;
 const store={call:async(name,args)=>{
  if(name==='search_candidates'||name==='search_candidates_promotional'){candidate={...args.p_filters,promotionalEnabled:name.endsWith('_promotional')};return [];}
  if(name==='search_coverage')return {};
  if(args.p_op==='rate')return {allowed:true};
  if(args.p_op==='snapshot'){snapshot=args.p_payload;return {id:owner,expires:Date.now()+60000};}
  if(args.p_op==='page')return {results:[],info:snapshot.info,hasMore:false};
  assert.fail(name);
 }};
 const search=loadSearch('src/lib/search/service.ts',{...deps,'./contract':c,'@/lib/supabase/admin':{createAdminClient:()=>null}});
 await search.search({query:'자료'}, {identity:c.ACTIVE_EMBEDDING},store);
 assert.equal(candidate.promotionalEnabled===true,enabled);assert.equal(snapshot.info.promotionalEnabled===true,enabled);
 assert.equal(snapshot.context,c.cursorContext(c.parseSearch({query:'자료'}),enabled));
 let providerCalls=0,version,persisted;
 const gemini=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator},{process:{env:{GEMINI_API_KEY:'fixture',GEMINI_MODEL:'gemini-fixture'}},fetch:async(_url,init)=>{
  providerCalls++;const body=JSON.parse(init.body);version=body.generationConfig.responseFormat.text.schema.properties.schemaVersion.enum[0];
  assert.equal(!!body.generationConfig.responseFormat.text.schema.properties.noiseAssessment,enabled);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(enabled?upgrade(cases[0].output):cases[0].output)}]}}]});
 }});
 const item={id:itemId,...reference,format:'text',content_text:cases[0].text,content_hash:null,processing_status:'queued',updated_at:reference.created_at,metadata:{}};
 const read={select(){return read;},eq(){return read;},maybeSingle:async()=>({data:item}),limit:async()=>({data:[]})};
 const claim={update(){return claim;},eq(){return claim;},select(){return claim;},maybeSingle:async()=>({data:{updated_at:'claimed'}})};
 const analysis=load('src/lib/items/analysis.ts',{...deps,'@/lib/gemini/validation':validator,'@/lib/gemini/client':gemini,'@/lib/items/filters':{isItemId:()=>true},'@/lib/supabase/server':{createClient:async()=>({from:()=>read})},'@/lib/supabase/admin':{createAdminClient:()=>({from:()=>claim,rpc:async(_name,args)=>{persisted=args;return {data:{action_count:0,created_count:0,reused_count:0,cached:false}};}})}});
 await analysis.analyzeOwnedItem(itemId);
 assert.equal(providerCalls,1);assert.equal(version,enabled?'0.3':'0.2');assert.equal(persisted.p_analysis.schemaVersion,version);
 assert.equal(persisted.p_analysis.eventObservations[0].date,'2026-10-24');assert.equal(persisted.p_analysis.actions.length,0);
 assert.equal(persisted.p_input_fingerprint,load('src/lib/items/analysis-policy.ts').analysisFingerprint(cases[0].text,'gemini-fixture',version));
 if(flag==='false')assert.equal(calls.length,0);
});

for(const fault of ['table','visibility','cache'])test('readiness '+fault+' missing/stale fails open without an override or persistence call',async()=>{
 const {gate,calls}=capability('true',true,fault);assert.equal(await gate.promotionalReady(),false);
 assert.equal(calls.some(u=>/set_noise_override|persist_/.test(u.pathname)),false);
});
test('unset/invalid flag and capability network failures disable feature without throwing',async()=>{
 for(const flag of [undefined,'FALSE','1',' true ']){const {gate,calls}=capability(flag,true);assert.equal(await gate.promotionalReady(),false);assert.equal(calls.length,0);}
 const g=load('src/lib/items/promotional-gate.ts',{'@/lib/supabase/server':{createClient:async()=>{throw new Error('unavailable');}}},{process:{env:{PROMOTIONAL_NOISE_ENABLED:'true'}}});
 assert.equal(await g.promotionalReady(),false);
});
test('contract disappearing after Library readiness retries once on the legacy query',async()=>{
 const urls=[];const {gate}=capability('true',true);
 const client=createClient('https://synthetic.invalid','fixture',{auth:{persistSession:false},global:{fetch:async url=>{
  const u=new URL(url);urls.push(u);return u.searchParams.has('item_is_visible')?Response.json({code:'42703'},{status:400}):Response.json([]);
 }}});
 const ui=uiLoader({'@/lib/items/promotional-gate':gate,'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/server':{createClient:async()=>client}});
 assert.equal((await ui('src/lib/items/queries.ts').listItems(ui('src/lib/items/filters.ts').parseItemQuery(new URLSearchParams()))).items.length,0);
 assert.equal(urls.length,2);assert.equal(urls[1].searchParams.has('item_is_visible'),false);
});
test('OFF override API performs zero noise RPCs; v0.3 persistence is converted to legacy without another AI call',async()=>{
 const {gate}=capability('false',true);let rpcCalls=0;
 const deps={'@/lib/items/promotional-gate':gate,'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/server':{createClient:async()=>{assert.fail('noise client must not be created');}}};
 await assert.rejects(()=>uiLoader(deps)('src/lib/items/noise.ts').noiseState(itemId,{userOverride:'force_show'}),e=>e.status===404);
 const analysis=load('src/lib/items/analysis.ts',{...deps,'@/lib/gemini/validation':validator,'@/lib/gemini/client':{},'@/lib/items/filters':{},'@/lib/supabase/admin':{}});
 await analysis.persistValidatedAnalysis({rpc:async(_name,args)=>{rpcCalls++;assert.equal(args.p_analysis.schemaVersion,'0.2');assert.equal(args.p_analysis.noiseAssessment,undefined);assert.equal(args.p_input_fingerprint,load('src/lib/items/analysis-policy.ts').analysisFingerprint(cases[0].text,'gemini-fixture','0.2'));return {data:{action_count:0,created_count:0,reused_count:0,cached:false}};}},{userId:owner,itemId,contentText:cases[0].text,contentHash:null,result:upgrade(cases[0].output),model:'gemini-fixture',fingerprint:'0'.repeat(64)});
 assert.equal(rpcCalls,1);
});
test('OFF reads existing v0.3 Event, Classification and Action through legacy Detail queries',async()=>{
 const {gate,calls}=capability('false',true);const v=upgrade(cases[0].output);
 const item={id:itemId,title:cases[0].text,...reference,format:'text',content_text:cases[0].text,processing_status:'completed',metadata:{aiAnalysis:{schemaVersion:'0.3',analyzedAt:reference.created_at,result:v}}};
 const responses=[item,{ai_primary_topic:'자료',ai_document_type:'general',ai_tags:[]},[{id:itemId,action_id:owner}],[{id:owner,title:'기존 할 일',action_type:'required',status:'open',deadline_status:'none',requirements:[],conditions:[]}],[]];
 const client=createClient('https://synthetic.invalid','fixture',{auth:{persistSession:false},global:{fetch:async()=>Response.json(responses.shift())}});
 const ui=uiLoader({'@/lib/items/promotional-gate':gate,'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/server':{createClient:async()=>client}});
 const detail=await ui('src/lib/items/queries.ts').getItemDetail(itemId);
 assert.equal(detail.aiAnalysis.schemaVersion,'0.3');assert.equal(detail.eventObservations[0].date,'2026-10-24');assert.equal(detail.actions[0].title,'기존 할 일');assert.equal(detail.classification.primaryTopic,'자료');assert.equal(calls.length,0);
});
test('legacy signed Search cursor retains context OFF, and mode mismatch returns safe 410 ON',async()=>{
 const env={SEARCH_CURSOR_SECRET:'synthetic-search-secret-at-least-32-characters'};
 const c=loadSearch('src/lib/search/contract.ts',{}, {process:{env}}),input=c.parseSearch({query:'자료'});
 const legacyContext=c.hash(JSON.stringify([input.query,input.filters,input.limit,input.semantic,c.ACTIVE_EMBEDDING.version]));
 assert.equal(c.cursorContext(input),legacyContext);
 const cursor=c.encodeCursor({session:owner,offset:20,limit:20,context:legacyContext,version:c.ACTIVE_EMBEDDING.version,expires:Date.now()+60000});
 for(const [ready,expectPage] of [[false,true],[true,false]]){
  let pages=0;const lib=loadSearch('src/lib/search/service.ts',{'./contract':c,'@/lib/items/promotional-gate':{promotionalReady:async()=>ready},'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/admin':{}});
  const work=()=>lib.search({...plain(input),cursor},{identity:c.ACTIVE_EMBEDDING},{call:async(_name,args)=>{if(args.p_op==='rate')return {allowed:true};assert.equal(args.p_op,'page');pages++;return {results:[],info:{},hasMore:false};}});
  if(expectPage)await work();else await assert.rejects(work,e=>e.status===410);
  assert.equal(pages,expectPage?1:0);
 }
});
test('Search schema-cache race falls back to preserved candidates without a second embedding or retry loop',async()=>{
 const c=loadSearch('src/lib/search/contract.ts',{}, {process:{env:{SEARCH_CURSOR_SECRET:'synthetic-search-secret-at-least-32-characters'}}});
 const {gate}=capability('true',true);const calls=[];let snapshot;
 const admin={rpc:async(name,args)=>{
  calls.push(name);
  if(name==='search_candidates_promotional')return {error:{code:'PGRST202'}};
  if(name==='search_candidates')return {data:[]};
  if(name==='search_coverage')return {data:{}};
  if(args.p_op==='rate')return {data:{allowed:true}};
  if(args.p_op==='snapshot'){snapshot=args.p_payload;return {data:{id:owner,expires:Date.now()+60000}};}
  if(args.p_op==='page')return {data:{results:[],info:snapshot.info,hasMore:false}};
  assert.fail(name);
 }};
 const lib=loadSearch('src/lib/search/service.ts',{'./contract':c,'@/lib/items/promotional-gate':gate,'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/admin':{createAdminClient:()=>admin}});
 const page=await lib.search({query:'자료',filters:{includePromotional:true}},{identity:c.ACTIVE_EMBEDDING,embedQuery:()=>assert.fail('no provider call')});
 assert.equal(page.status,'no_results');assert.equal(calls.filter(x=>x==='search_candidates_promotional').length,1);assert.equal(calls.filter(x=>x==='search_candidates').length,1);
 assert.equal(snapshot.info.promotionalEnabled,undefined);assert.equal(snapshot.info.appliedFilters.includePromotional,undefined);
 assert.equal(snapshot.context,c.cursorContext(c.parseSearch({query:'자료'})));
});
test('isolated OLD/NEW SQL: readiness, legacy candidates/snapshots, protected promotional snapshots and similar RPC',async()=>{
 const db=await noiseDb({migrated:false});
 const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
 try{
  await db.query('insert into auth.users(id) values($1)',[owner]);
  await db.query("insert into public.items(id,user_id,source,format,title,content_text,processing_status) values($1,$2,'manual','text','상품 할인','상품 할인','completed')",[itemId,owner]);
  const legacy=await scalar("select public.search_runtime('snapshot',$1,$2::jsonb)",[owner,JSON.stringify({context:'legacy',version:'unused',results:[],info:{intent:'documents'}})]);
  const similarBefore=await scalar("select prosrc from pg_proc where oid='public.search_similar(uuid,uuid,text,integer)'::regprocedure");
  await db.exec(readFileSync(migrationPath,'utf8'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  assert.equal(await scalar('select public.promotional_noise_ready()'),true);
  await db.exec('reset role');
  const active=await scalar("select public.search_runtime('snapshot',$1,$2::jsonb)",[owner,JSON.stringify({context:'active',version:'unused',results:[],info:{promotionalEnabled:true}})]);
  await db.query("select public.set_noise_override($1,'force_promotional')",[itemId]);
  assert.equal(await scalar('select count(*)::int from private.search_sessions where id=$1',[legacy.id]),1);
  assert.equal(await scalar('select count(*)::int from private.search_sessions where id=$1',[active.id]),0);
  const query=filters=>scalar(`select public.${filters.promotionalEnabled?'search_candidates_promotional':'search_candidates'}($1,'unused','상품',null,$2::jsonb,'{"kind":"documents"}')`,[owner,JSON.stringify({source:[],format:[],...filters})]);
  assert.equal((await query({})).length,1);assert.equal((await query({promotionalEnabled:true})).length,0);assert.equal((await query({promotionalEnabled:true,includePromotional:true})).length,1);
  const page=await scalar("select public.search_runtime('page',$1,$2::jsonb)",[owner,JSON.stringify({session:legacy.id,context:'legacy',version:'unused',offset:0,limit:20})]);assert.equal(page.results.length,0);
  assert.equal(await scalar("select prosrc from pg_proc where oid='public.search_similar(uuid,uuid,text,integer)'::regprocedure"),similarBefore);
  await db.exec('drop function public.item_is_visible(public.items)');
  assert.equal(await scalar('select public.promotional_noise_ready()'),false);
  assert.equal((await query({})).length,1);
  await db.exec('drop table public.item_noise_assessments');
  assert.equal(await scalar('select public.promotional_noise_ready()'),false);
  assert.equal((await query({})).length,1);
 }finally{await db.close();}
});
