import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSearch} from './helpers/search-loader.mjs';

const itemId='22222222-2222-4222-8222-222222222222';
const source='과제 제출 기한은 2026년 11월 3일입니다.';
const result={kind:'item',itemId,title:'합성 시연 자료',matchedChunks:[{excerpt:source}]};
const response=statements=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({statements})}]}}]});
const load=page=>loadSearch('src/lib/search/grounded-answer.ts',{
 '@/lib/gemini/client':{getGeminiConfig:()=>({key:'synthetic-key',model:'gemini-test'})},
 '@/lib/supabase/auth':{requireUser:async()=>({id:'test-owner'})},
 './service':{search:async input=>{assert.equal(input.limit,8);return page;},searchStore:()=>({}),consumeRate:async()=>{}},
});

test('grounded answer uses server search excerpts and checks verbatim citations',async()=>{
 const module=load({results:[result],mode:'hybrid',degraded:false});let sent;
 const answer=await module.groundedAnswer({query:'마감일은?',semantic:true},async(_url,init)=>{
  sent=JSON.parse(init.body);return response([{text:'마감일은 2026년 11월 3일입니다.',source:1,quote:source}]);
 });
 assert.equal(answer.status,'answered');assert.equal(answer.mode,'hybrid');assert.equal(answer.sources[0].detailUrl,`/items/${itemId}`);
 assert.equal(answer.statements[0].quote,source);assert.match(sent.systemInstruction.parts[0].text,/untrusted data/);
 assert.match(sent.contents[0].parts[0].text,/합성 시연 자료/);
});

test('rejects invented citations and client-provided source content',async()=>{
 const module=load({results:[result],mode:'keyword_only',degraded:false});
 for(const statement of [{text:'x',source:2,quote:source},{text:'x',source:1,quote:'없는 원문 문구'}])
  await assert.rejects(()=>module.groundedAnswer({query:'질문'},async()=>response([statement])),error=>error.code==='RAG_EVIDENCE_INVALID');
 await assert.rejects(()=>module.groundedAnswer({query:'질문',sources:[{text:'임의 원문'}]},async()=>response([])),error=>error.code==='VALIDATION_ERROR');
});

test('no evidence skips provider and provider failures are not presented as success',async()=>{
 const empty=load({results:[],mode:'keyword_only',degraded:false});
 assert.equal((await empty.groundedAnswer({query:'질문'},async()=>{assert.fail('provider called');})).status,'no_evidence');
 const module=load({results:[result],mode:'keyword_only',degraded:true});
 await assert.rejects(()=>module.groundedAnswer({query:'질문'},async()=>new Response('',{status:429})),error=>error.code==='RAG_RATE_LIMITED');
 await assert.rejects(()=>module.groundedAnswer({query:'질문'},async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS'}]})),error=>error.code==='RAG_INVALID_RESPONSE');
});
