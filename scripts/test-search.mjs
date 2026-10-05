import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSearch} from './search-loader.mjs';
const c=loadSearch('src/lib/search/contract.ts'),chunks=loadSearch('src/lib/search/chunker.ts'),p=loadSearch('src/lib/search/provider.ts');
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const plain=v=>JSON.parse(JSON.stringify(v));
test('request schema rejects client owner/vector, invalid dates, cursor/limit bounds',()=>{
 assert.equal(c.parseSearch({query:' 농협 '}).limit,20);
 for(const v of [{query:'x',userId:owner},{query:'x',vector:[1]},{query:''},{query:'x',limit:51},{query:'x',filters:{from:'2026-02-30'}},{query:'x',filters:{from:'2026-10-05',to:'2026-10-01'}},{query:'x',filters:{topic:[]}}])assert.throws(()=>c.parseSearch(v));
});
test('Action/date grammar has explicit deadline SQL intent without LLM or invented year',()=>{
 const now=Date.parse('2026-10-05T06:00:00Z');
 assert.equal(c.searchIntent('해야 할 일',now).kind,'actions');assert.equal(c.searchIntent('마감',now).deadlineOnly,true);
 assert.deepEqual(plain(c.searchIntent('내일까지',now)),{kind:'actions',from:null,to:'2026-10-06',term:'',deadlineOnly:true,warning:null});
 assert.equal(c.searchIntent('이번 주 제출',now).from,'2026-10-05');assert.equal(c.searchIntent('이번 주 제출',now).to,'2026-10-11');
 assert.equal(c.searchIntent('지난달 회의 일정',now).from,'2026-09-01');
 assert.equal(c.searchIntent('10월까지 제출해야 하는 자료',now).warning,'YEAR_REQUIRED');
});
test('Unicode chunking preserves exact source spans, maximum size, PDF boundaries and Drive tabs',()=>{
 const text='😀한글. '.repeat(600),item={id,user_id:owner,title:'제목',content_text:text,source:'gmail',metadata:{},updated_at:'2026-10-05'};
 const result=chunks.chunkItem(item);assert.ok(result.chunks.length>1);
 for(const ch of result.chunks){assert.ok(Array.from(ch.content).length<=1200);assert.equal(Array.from(text).slice(ch.metadata.startChar,ch.metadata.endChar).join(''),ch.content);}
 const pages='첫째 페이지😀\n\n두번째 페이지';const boundary=Array.from('첫째 페이지😀').length;
 const pdf=chunks.chunkItem({...item,source:'upload',content_text:pages,metadata:{upload:{extraction:{pages:[{page:1,start:0,end:boundary,method:'embedded'},{page:2,start:boundary+2,end:Array.from(pages).length,method:'ocr'}]}}}});
 assert.deepEqual(plain(pdf.chunks.map(ch=>ch.metadata.page)),[1,2]);
 const docs=chunks.chunkItem({...item,source:'drive',content_text:'ABCDEF',metadata:{drive:{tabs:[{id:'a',start:0,end:3},{id:'b',start:3,end:6}]}}});assert.deepEqual(plain(docs.chunks.map(ch=>ch.metadata.tabId)),['a','b']);
 assert.throws(()=>chunks.chunkItem({...item,content_text:'a'.repeat(100001)}));
 assert.equal(chunks.chunkItem(item).fingerprint,result.fingerprint);assert.notEqual(chunks.chunkItem({...item,title:'changed'}).fingerprint,result.fingerprint);
});
test('signed cursors reject tamper, mismatched query/version and expiration',()=>{
 process.env.SEARCH_CURSOR_SECRET='isolated-test-secret-at-least-32-characters';
 const input=c.parseSearch({query:'x'}),context=c.cursorContext(input),cursor=c.encodeCursor({session:id,offset:20,limit:20,context,version:c.ACTIVE_EMBEDDING.version,expires:Date.now()+60000});
 assert.equal(c.decodeCursor(cursor,context).offset,20);assert.throws(()=>c.decodeCursor(cursor+'x',context));assert.throws(()=>c.decodeCursor(cursor,c.cursorContext(c.parseSearch({query:'y'}))));
 assert.throws(()=>c.decodeCursor(cursor,context,'other-version'));
 const expired=c.encodeCursor({session:id,offset:20,limit:20,context,version:c.ACTIVE_EMBEDDING.version,expires:0});assert.throws(()=>c.decodeCursor(expired,context));
});
test('provider independently sends each chunk, parses REST singular embedding, blocks without opt-in',async()=>{
 let calls=[];const provider=p.createEmbeddingProvider(async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({embedding:{values:Array.from({length:768},(_,i)=>i===0?1:0)}});});
 process.env.SEARCH_SEMANTIC_ENABLED='false';await assert.rejects(()=>provider.embedDocument('title','text'));assert.equal(calls.length,0);
 process.env.SEARCH_SEMANTIC_ENABLED='true';process.env.GEMINI_API_KEY='synthetic-test-key';
 await provider.embedDocument('title','one');await provider.embedDocument('title','two');await provider.embedQuery('query');
 assert.equal(calls.length,3);assert.equal(calls[0].content.parts.length,1);assert.match(calls[0].content.parts[0].text,/text: one$/);assert.match(calls[1].content.parts[0].text,/text: two$/);assert.match(calls[2].content.parts[0].text,/task: search result/);
 assert.equal(calls[0].embedContentConfig.autoTruncate,false);assert.throws(()=>p.validateVector([1]));assert.throws(()=>p.validateVector(Array(768).fill(0)));
 delete process.env.GEMINI_API_KEY;process.env.SEARCH_SEMANTIC_ENABLED='false';
});
test('keyword/action searches never call provider; cache hits avoid external query and quota',async()=>{
 let external=0,calls=[];const provider={identity:c.ACTIVE_EMBEDDING,embedQuery:async()=>{external++;return Array.from({length:768},(_,i)=>i===0?1:0);}};
 const store={call:async(name,args)=>{calls.push({name,args});if(name==='search_candidates')return [];if(args.p_op==='rate')return {allowed:true};if(args.p_op==='snapshot')return {id,expires:Date.now()+300000};if(args.p_op==='page')return {results:[],info:{},hasMore:false};if(args.p_op==='query_claim')return {state:'cached',embedding:JSON.stringify(Array.from({length:768},(_,i)=>i===0?1:0))};return {};}};
 const service=loadSearch('src/lib/search/service.ts',{'@/lib/supabase/auth':{requireUser:async()=>({id:owner})},'@/lib/supabase/admin':{createAdminClient:()=>{throw new Error('unexpected real client');}}});
 process.env.SEARCH_SEMANTIC_ENABLED='true';await service.search({query:'해야 할 일',semantic:true},provider,store);await service.search({query:'농협'},provider,store);await service.search({query:'농협',semantic:true},provider,store);
 assert.equal(external,0);assert.equal(calls.filter(v=>v.args.p_payload?.category==='embedding').length,0);assert.ok(calls.some(v=>v.args.p_intent?.kind==='actions'));
 const serializer=service.serializeResult({kind:'item',itemId:id,title:'source',source:'upload',format:'pdf',score:1,matchType:'keyword',snapshotUpdatedAt:'x',matchedChunks:[{content:'😀actual evidence',location:{startChar:0,endChar:16,page:2}}],embedding:[1],metadata:{secret:'hidden'}},'actual');
 assert.equal(serializer.matchedChunks[0].location.page,2);assert.equal(serializer.embedding,undefined);assert.equal(serializer.metadata,undefined);
 process.env.SEARCH_SEMANTIC_ENABLED='false';
});
