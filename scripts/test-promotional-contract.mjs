import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createClient} from '@supabase/supabase-js';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
import {uiLoader} from './content-ui-loader.mjs';
import {fixture,quote} from './analysis-fixtures.mjs';
import {cases,reference} from './content-calendar-fixtures.mjs';
import {loadSearch} from './search-loader.mjs';
const validator=load('src/lib/gemini/validation.ts');
const noise={verdict:'normal',confidence:null,evidence:[],reasons:['non_promotional'],protectionSignals:[]};
const upgrade=v=>({...structuredClone(v),schemaVersion:'0.3',noiseAssessment:structuredClone(noise)});
const plain=v=>JSON.parse(JSON.stringify(v));
const gate={'@/lib/items/promotional-gate':{promotionalReady:async()=>true,missingPromotionalContract:()=>false}};

test('one Gmail structured request returns v0.3 noise and a yearless Event; no separate call or Action',async()=>{
 const dates=load('src/lib/gemini/date-context.ts');let count=0;
 const client=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator},{process:{env:{GEMINI_API_KEY:'fixture',GEMINI_MODEL:'gemini-fixture'}},fetch:async(_url,request)=>{
  count++;const body=JSON.parse(request.body);assert.ok(body.generationConfig.responseFormat.text.schema.properties.noiseAssessment);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(upgrade(cases[0].output))}]}}]});
 }});
 const output=await client.analyzeGmailText(cases[0].text,[],dates.analysisDateContext(reference),'0.3');
 assert.equal(count,1);assert.equal(output.schemaVersion,'0.3');assert.equal(output.eventObservations[0].date,'2026-10-24');assert.equal(output.actions.length,0);assert.equal(output.noiseAssessment.verdict,'normal');
});

test('v0.2 stored result is accepted but a fresh provider response cannot omit noise',async()=>{
 assert.equal(validator.validateAnalysis(cases[0].output,cases[0].text).schemaVersion,'0.2');
 let calls=0;const client=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator},{process:{env:{GEMINI_API_KEY:'fixture',GEMINI_MODEL:'gemini-fixture'}},fetch:async()=>{
  calls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(cases[0].output)}]}}]});
 }});await assert.rejects(()=>client.analyzeGmailText(cases[0].text,[],undefined,'0.3'),e=>e.code==='GEMINI_INCOMPLETE');assert.equal(calls,1);
});

test('noise evidence, protection evidence and confidence validate without coercing a promotional Event to normal',()=>{
 const text=cases[0].text,v=upgrade(cases[0].output);v.noiseAssessment={...noise,verdict:'promotional',evidence:[quote(text)],reasons:['general_promotion']};
 const valid=validator.validateAnalysis(v,text);assert.equal(valid.noiseAssessment.verdict,'promotional');assert.equal(valid.eventObservations.length,1);
 for(const mutate of [n=>{n.evidence=[];},n=>{n.evidence=[quote('invented')];},n=>{n.reasons=['non_promotional'];},n=>{n.confidence=2;},n=>{n.protectionSignals=[{reason:'security',evidence:quote('invented')}];}]){const bad=structuredClone(v);mutate(bad.noiseAssessment);assert.throws(()=>validator.validateAnalysis(bad,text));}
 const unclear=upgrade(cases[0].output);unclear.noiseAssessment.verdict='uncertain';assert.throws(()=>validator.validateAnalysis(unclear,text));
});

test('classification remains independent and changing noise cannot change its user override contract',()=>{
 const legacy=fixture(),newer=upgrade(legacy);const text=legacy.actions[0].evidence[0].text;
 newer.noiseAssessment={...noise,verdict:'promotional',evidence:[quote(text)],reasons:['general_promotion']};
 assert.deepEqual(newer.classification,legacy.classification);
 const presentation=uiLoader(gate)('src/lib/items/presentation.ts');assert.deepEqual(plain(presentation.effectiveClassification({ai_primary_topic:'A',user_primary_topic:'B',ai_tags:['x'],user_tags:[],ai_document_type:'general',user_document_type:null}).tags),[]);
});

test('Library toggle changes cursor context, resets pagination, preserves source/date and uses DB computed predicate',async()=>{
 const ui=uiLoader(gate),filters=ui('src/lib/items/filters.ts');
 const off=filters.parseItemQuery(new URLSearchParams('source=gmail&from=2026-10-01'));
 const on=filters.parseItemQuery(new URLSearchParams('source=gmail&from=2026-10-01&includePromotional=true'));
 const cursor=filters.encodeCursor({createdAt:'2026-10-12T00:00:00Z',id:'11111111-1111-4111-8111-111111111111'},off);
 assert.throws(()=>filters.parseItemQuery(new URLSearchParams('source=gmail&from=2026-10-01&includePromotional=true&cursor='+cursor)));
 assert.throws(()=>filters.parseItemQuery(new URLSearchParams('includePromotional=invalid')));
 const {LibraryToolbar}=ui('src/components/library/library-toolbar.tsx');const html=renderToStaticMarkup(React.createElement(LibraryToolbar,{query:off,promotionalEnabled:true}));
 assert.match(html,/광고 포함/);assert.match(html,/includePromotional=true/);assert.doesNotMatch(html,/cursor=/);
 const requests=[];const client=createClient('https://synthetic.invalid','fixture',{auth:{persistSession:false},global:{fetch:async(url)=>{requests.push(new URL(url));return Response.json([]);}}});
 const queries=uiLoader({...gate,'@/lib/supabase/auth':{requireUser:async()=>({id:'owner'})},'@/lib/supabase/server':{createClient:async()=>client}})('src/lib/items/queries.ts');
 await queries.listItems(off);await queries.listItems(on);
 assert.equal(requests[0].searchParams.get('item_is_visible'),'eq.true');assert.equal(requests[1].searchParams.has('item_is_visible'),false);assert.equal(requests[0].searchParams.get('limit'),'31');assert.equal(requests[0].searchParams.get('user_id'),'eq.owner');
});

test('Home focuses on Calendar and Actions without a hidden recent library or promotional toggle',async()=>{
 const requests=[];const ui=uiLoader({...gate,'@/lib/supabase/auth':{getCurrentUser:async()=>({id:'owner'})},'@/lib/items/queries':{listItems:async q=>{requests.push(q);return {items:[]};}},'@/lib/google/connections':{getGoogleConnectionSummary:async()=>null},'@/components/workspace/request-clock':{getWorkspaceClock:async()=>Date.parse('2026-10-12')},'@/components/shell/app-shell':{AppShell:({children})=>React.createElement('main',{},children)},'@/components/actions/schedule-workspace':{ScheduleWorkspace:()=>null}});
 const {TodayView}=ui('src/components/home/today-view.tsx');const a=renderToStaticMarkup(await TodayView()),b=renderToStaticMarkup(await TodayView({includePromotional:true}));
 assert.equal(requests.length,0);assert.doesNotMatch(a,/광고 포함|최근 추가된 자료/);assert.doesNotMatch(b,/광고 포함|최근 추가된 자료/);assert.match(a,/오늘 캘린더/);assert.match(b,/다가오는 일정/);
});

test('Search toggle is strictly boolean and cannot reuse the OFF signed cursor',()=>{
 process.env.SEARCH_CURSOR_SECRET='synthetic-cursor-secret-at-least-32-characters';
 const c=uiLoader(gate)('src/lib/search/contract.ts'),off=c.parseSearch({query:'자료'}),on=c.parseSearch({query:'자료',filters:{includePromotional:true}});
 const context=c.cursorContext(off),token=c.encodeCursor({session:'11111111-1111-4111-8111-111111111111',offset:20,limit:20,context,version:c.ACTIVE_EMBEDDING.version,expires:Date.now()+60000});
 assert.throws(()=>c.decodeCursor(token,c.cursorContext(on)));assert.throws(()=>c.parseSearch({query:'자료',filters:{includePromotional:'true'}}));
});

test('noise override parser rejects generic hide/show, AI writes and extra identifiers; authentication precedes RPC',async()=>{
 const errors=uiLoader(gate)('src/lib/items/writes.ts');let calls=0;
 const modules=uiLoader({...gate,'@/lib/supabase/auth':{requireUser:async()=>{throw new Error('unauthorized');}},'@/lib/supabase/server':{createClient:async()=>{calls++;}},'@/lib/items/writes':errors});
 const n=modules('src/lib/items/noise.ts');for(const value of ['force_show','force_promotional',null])assert.equal(n.parseNoiseOverride({userOverride:value}),value);
 for(const v of [{userOverride:'hide'},{userOverride:'show'},{userOverride:'force_show',aiVerdict:'normal'},{userOverride:'force_show',userId:'foreign'},{}])assert.throws(()=>n.parseNoiseOverride(v));
 await assert.rejects(()=>n.noiseState('11111111-1111-4111-8111-111111111111',{userOverride:'force_show'}),/unauthorized/);assert.equal(calls,0);
});

test('Search ON/OFF reuses query embedding cache; invalidated snapshots map to 410',async()=>{
 process.env.SEARCH_SEMANTIC_ENABLED='true';process.env.SEARCH_CURSOR_SECRET='synthetic-cursor-secret-at-least-32-characters';
 const owner='11111111-1111-4111-8111-111111111111';
 const c=loadSearch('src/lib/search/contract.ts');
 const lib=loadSearch('src/lib/search/service.ts',{...gate,'./contract':c,'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/admin':{createAdminClient:()=>null}});
 const keys=[],cache=new Map();let providerCalls=0,info,failPage=false;
 const provider={identity:c.ACTIVE_EMBEDDING,embedQuery:async()=>{providerCalls++;return Array(768).fill(1);}};
 const store={call:async(name,args)=>{
  if(name==='search_candidates_promotional')return [];if(name==='search_coverage')return {};
  const p=args.p_payload;
  if(args.p_op==='rate')return {allowed:true};
  if(args.p_op==='query_claim'){keys.push(p.key);return cache.has(p.key)?{state:'cached',embedding:cache.get(p.key)}:{state:'claimed',attempt:owner};}
  if(args.p_op==='query_finish'){cache.set(p.key,p.embedding);return {};}
  if(args.p_op==='snapshot'){info=p.info;return {id:owner,expires:Date.now()+60000};}
  if(args.p_op==='page'){if(failPage)throw new c.SearchError('NOT_FOUND',404);return {results:[],info,hasMore:false};}
  throw new Error('unexpected RPC');
 }};
 await lib.search({query:'자료',semantic:true},provider,store);
 await lib.search({query:'자료',semantic:true,filters:{includePromotional:true}},provider,store);
 assert.equal(providerCalls,1);assert.equal(keys[0],keys[1]);
 failPage=true;await assert.rejects(()=>lib.search({query:'자료'},provider,store),e=>e.code==='CURSOR_EXPIRED'&&e.status===410);
});

test('override HTTP API enforces origin, strict body and authenticated owner RPC with safe errors',async()=>{
 class AuthError extends Error{}
 let auth=true,foreign=false,calls=0;
 const writes=uiLoader(gate)('src/lib/items/writes.ts');
 const authModule={AuthenticationRequiredError:AuthError,requireUser:async()=>{if(!auth)throw new AuthError();return {id:'owner'};}};
 const modules=uiLoader({...gate,'@/lib/supabase/auth':authModule,'@/lib/items/writes':writes,'./writes':writes,'@/lib/supabase/server':{createClient:async()=>({from(){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:foreign?null:{source:'gmail'},error:null})};return q;},rpc:async(name,args)=>{
  calls++;assert.equal(name,'set_noise_override');assert.deepEqual(Object.keys(args).sort(),['p_item_id','p_override']);
  return foreign?{error:{code:'P0002'}}:{data:{aiVerdict:'normal',userOverride:args.p_override,effectiveVisibility:args.p_override==='force_promotional'?'HIDE':'SHOW',protectionState:[]},error:null};
 }})}});
 const route=modules('src/app/api/v1/items/[itemId]/noise-override/route.ts'),context={params:Promise.resolve({itemId:'11111111-1111-4111-8111-111111111111'})};
 const request=(value,origin='http://localhost')=>new Request('http://localhost/api/v1/items/x/noise-override',{method:'PATCH',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await route.PATCH(request({userOverride:'force_show'},'https://foreign.invalid'),context)).status,403);assert.equal(calls,0);
 assert.equal((await route.PATCH(request({userOverride:'force_show',aiVerdict:'normal'}),context)).status,400);assert.equal(calls,0);
 const saved=await route.PATCH(request({userOverride:'force_promotional'}),context);assert.equal(saved.status,200);assert.equal((await saved.json()).effectiveVisibility,'HIDE');assert.equal(saved.headers.get('Cache-Control'),'private, no-store');
 foreign=true;assert.equal((await route.PATCH(request({userOverride:null}),context)).status,404);
 auth=false;const before=calls;assert.equal((await route.PATCH(request({userOverride:'force_show'}),context)).status,401);assert.equal(calls,before);
});
