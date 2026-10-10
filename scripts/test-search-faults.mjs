import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSearch} from './search-loader.mjs';
const owner='11111111-1111-4111-8111-111111111111',id='30000000-0000-4000-8000-000000000001';
const c=loadSearch('src/lib/search/contract.ts'),p=loadSearch('src/lib/search/provider.ts');
test('embedding faults: 429/503/timeout/malformed/dimension/zero/nonfinite',async()=>{
 process.env.SEARCH_SEMANTIC_ENABLED='true';process.env.GEMINI_API_KEY='synthetic-isolated-key';
 for(const status of [429,503]){const provider=p.createEmbeddingProvider(async()=>new Response('',{status,headers:{'Retry-After':'7'}}));await assert.rejects(()=>provider.embedQuery('synthetic'),e=>e.code==='EMBEDDING_UNAVAILABLE'&&e.retryAfter===7);}
 const timeout=p.createEmbeddingProvider(async()=>{throw new Error('synthetic timeout');});await assert.rejects(()=>timeout.embedQuery('synthetic'),e=>e.code==='EMBEDDING_UNAVAILABLE');
 for(const values of [null,[1],Array(768).fill(0),Array(767).fill(1)]){const provider=p.createEmbeddingProvider(async()=>Response.json({embedding:{values}}));await assert.rejects(()=>provider.embedQuery('synthetic'),e=>e.code==='INVALID_EMBEDDING');}
 const finite=Array(768).fill(1);finite[2]=Infinity;assert.throws(()=>p.validateVector(finite),e=>e.code==='INVALID_EMBEDDING');
});
test('query provider failures preserve keyword results with degraded true',async()=>{
 process.env.SEARCH_SEMANTIC_ENABLED='true';process.env.SEARCH_CURSOR_SECRET='isolated-search3-cursor-secret-32-plus';
 const lib=loadSearch('src/lib/search/service.ts',{'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/admin':{createAdminClient:()=>null}});
 for(const fault of [429,503,'timeout','malformed']){
  let info,candidates=0,released=0;const store={call:async(name,args)=>{if(name==='search_coverage')return {totalItems:1,semanticIndexedItems:0};if(name==='search_candidates'){assert.equal(args.p_vector,null);candidates++;return [{kind:'item',itemId:id,title:'합성 keyword',source:'manual',format:'text',score:.01,matchType:'keyword',matchedChunks:[]}];}if(args.p_op==='rate')return {allowed:true};if(args.p_op==='query_claim')return {state:'claimed',attempt:id};if(args.p_op==='query_release'){released++;return {};}if(args.p_op==='snapshot'){info=args.p_payload.info;return {id,expires:Date.now()+300000};}if(args.p_op==='page')return {results:[{itemId:id}],info,hasMore:false};throw new Error('unexpected operation');}};
  const provider=p.createEmbeddingProvider(async()=>{if(fault==='timeout')throw new Error('synthetic timeout');if(fault==='malformed')return Response.json({embedding:{values:[1]}});return new Response('',{status:fault,headers:{'Retry-After':'2'}});});
  const result=await lib.search({query:'합성 keyword',semantic:true},provider,store);assert.equal(result.mode,'keyword_only');assert.equal(result.degraded,true);assert.equal(result.results.length,1);assert.equal(result.semantic.querySentToProvider,true);assert.equal(candidates,1);assert.equal(released,1);
 }
});
test('query cache keys include effective filter/timezone/version; user travels to SQL',async()=>{
 process.env.SEARCH_SEMANTIC_ENABLED='true';let keys=[],users=[],info;
 const lib=loadSearch('src/lib/search/service.ts',{'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/admin':{createAdminClient:()=>null}});
 const store={call:async(name,args)=>{users.push(args.p_user_id);if(name==='search_candidates')return [];if(name==='search_coverage')return {};if(args.p_op==='rate')return {allowed:true};if(args.p_op==='query_claim'){keys.push(args.p_payload.key);return {state:'cached',embedding:JSON.stringify(Array(768).fill(1))};}if(args.p_op==='snapshot'){info=args.p_payload.info;return {id,expires:Date.now()+300000};}if(args.p_op==='page')return {results:[],info,hasMore:false};return {};}};
 const provider={identity:c.ACTIVE_EMBEDDING};for(const filters of [{},{source:['gmail']},{from:'2026-10-01',to:'2026-10-02'}])await lib.search({query:'합성',semantic:true,filters},provider,store);
 assert.equal(new Set(keys).size,3);assert.ok(users.every(v=>v===owner));assert.equal(keys[0],c.hash(JSON.stringify([c.ACTIVE_EMBEDDING.version,'합성',{source:[],format:[],from:null,to:null},'Asia/Seoul'])));
});

test('Search RPC conflicts preserve STALE_INPUT/409 and one RPC; unrelated failures stay 503',async()=>{
 const lib=loadSearch('src/lib/search/service.ts',{'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/admin':{createAdminClient:()=>null}});
 for(const name of ['search_runtime','search_index'])for(const code of ['40001','PT409','XX000']){let calls=0;const store=lib.searchStore({rpc:async()=>{calls++;return {error:{code}};}});await assert.rejects(()=>store.call(name,{}),e=>e.code===(code==='XX000'?'SEARCH_STORAGE_UNAVAILABLE':'STALE_INPUT')&&e.status===(code==='XX000'?503:409));assert.equal(calls,1);}
});
