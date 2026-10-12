import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
import {fixture,content} from './analysis-fixtures.mjs';
const id='11111111-1111-4111-8111-111111111111',aid='33333333-3333-4333-8333-333333333333';
const policy=load('src/lib/items/analysis-policy.ts');
const presentation=load('src/lib/items/presentation.ts');
const filters={isItemId:v=>/^[a-f0-9-]{36}$/.test(v)};
class AuthError extends Error {}
function harness({anonymous=false,foreign=false}={}) {
 const graph={item:{id,user_id:'owner'},classification:{id:'c',item_id:id,user_id:'owner',ai_primary_topic:'AI',ai_document_type:'notice',ai_tags:['AI'],user_primary_topic:null,user_document_type:null,user_tags:null,user_edited_at:null,updated_at:'old'},action:{id:aid,user_id:'owner',status:'open',completed_at:null,updated_at:'old',deadline_date:'2026-10-15'},evidence:[{text:'preserve'}]};
 let updates=0,rpcs=0,admins=0;
 const query=(table,admin=false)=>{const where={};let patch=null;
  const q={select(){return q;},eq(k,v){where[k]=v;return q;},update(v){patch=v;return q;},async maybeSingle(){
   const row=graph[table==='items'?'item':table==='actions'?'action':'classification'];
   if(!row||Object.entries(where).some(([k,v])=>row[k]!==v))return {data:null,error:null};
   if(patch){assert.equal(admin,true);assert.deepEqual(Object.keys(patch).sort(),['completed_at','status']);Object.assign(row,patch,{updated_at:`new${++updates}`});}
   return {data:structuredClone(row),error:null};},async single(){return q.maybeSingle();}};return q;};
 const client={from:t=>query(t),async rpc(name,args){rpcs++;assert.equal(name,'set_classification_override');Object.assign(graph.classification,{user_primary_topic:args.p_primary_topic,user_document_type:args.p_document_type,user_tags:args.p_tags,user_edited_at:'edited',updated_at:'edited'});return {error:null};}};
 const auth={AuthenticationRequiredError:AuthError,async requireUser(){if(anonymous)throw new AuthError();return {id:foreign?'foreign':'owner'};}};
 const imports={'@/lib/supabase/auth':auth,'@/lib/supabase/server':{async createClient(){return client;}},'@/lib/supabase/admin':{createAdminClient(){admins++;return {from:t=>query(t,true)};}},'@/lib/items/filters':filters,'@/lib/items/presentation':presentation};
 const writes=load('src/lib/items/writes.ts',imports);return {writes,graph,auth,counts:()=>({updates,rpcs,admins})};
}
test('Classification owner edit preserves AI fields and exposes effective/User Edited/timestamps',async()=>{
 const h=harness(),ai=JSON.stringify([h.graph.classification.ai_primary_topic,h.graph.classification.ai_tags]);
 const r=await h.writes.updateClassification(id,{primaryTopic:'사용자 주제'});assert.equal(r.effectiveClassification.primaryTopic,'사용자 주제');assert.equal(r.editedByUser,true);assert.equal(r.updatedAt,'edited');assert.equal(JSON.stringify([h.graph.classification.ai_primary_topic,h.graph.classification.ai_tags]),ai);
});
test('partial Classification PATCH keeps omitted overrides; empty tags is an explicit override',async()=>{
 const h=harness();h.graph.classification.user_primary_topic='Existing';await h.writes.updateClassification(id,{tags:[]});assert.equal(h.graph.classification.user_primary_topic,'Existing');assert.equal(h.graph.classification.user_tags.length,0);
});
for(const [name,options]of [['anonymous',{anonymous:true}],['cross-user',{foreign:true}]])test(`Classification ${name} is blocked before any RPC/admin`,async()=>{const h=harness(options);await assert.rejects(h.writes.updateClassification(id,{primaryTopic:'No'}));assert.equal(h.counts().rpcs,0);assert.equal(h.counts().admins,0);});
test('Classification arbitrary ITEM and unknown/invalid fields are rejected',async()=>{
 const h=harness();for(const body of [{},null,[],{userId:'other'},{primaryTopic:''},{tags:['']},{tags:Array(21).fill('tag')},{documentType:'bad'},{tags:['x\u0000']}])assert.throws(()=>h.writes.parseClassification(body));
 await assert.rejects(h.writes.updateClassification('arbitrary',{primaryTopic:'No'}));assert.equal(h.counts().rpcs,0);
});
test('Classification normalization and existing SPEC null override contract',()=>{
 const w=harness().writes;assert.equal(w.parseClassification({primaryTopic:'  주제  '}).primaryTopic,'주제');assert.equal(w.parseClassification({primaryTopic:null}).primaryTopic,null);
});
test('Action complete stamps server time, keeps Deadline/Evidence and complete replay is idempotent',async()=>{
 const h=harness(),evidence=JSON.stringify(h.graph.evidence);const first=await h.writes.updateActionStatus(aid,{status:'completed'});const again=await h.writes.updateActionStatus(aid,{status:'completed'});
 assert.equal(first.completed,true);assert.ok(Number.isFinite(Date.parse(first.completedAt)));assert.equal(again.completedAt,first.completedAt);assert.equal(h.counts().updates,1);assert.equal(h.graph.action.deadline_date,'2026-10-15');assert.equal(JSON.stringify(h.graph.evidence),evidence);
});
test('Action restore clears completedAt and repeated restore does not write',async()=>{
 const h=harness();await h.writes.updateActionStatus(aid,{status:'completed'});const r=await h.writes.updateActionStatus(aid,{status:'open'});await h.writes.updateActionStatus(aid,{status:'open'});assert.equal(r.completed,false);assert.equal(r.completedAt,null);assert.equal(h.counts().updates,2);
});
for(const [name,options]of [['anonymous',{anonymous:true}],['cross-user',{foreign:true}]])test(`Action ${name} is blocked before service writer`,async()=>{const h=harness(options);await assert.rejects(h.writes.updateActionStatus(aid,{status:'completed'}));assert.equal(h.counts().admins,0);});
test('Action rejects arbitrary IDs, client completedAt and unknown states',async()=>{
 const h=harness();for(const body of [{completed:true},{status:'done'},{status:'completed',completedAt:'invented'},{status:'open',userId:'other'}])assert.throws(()=>h.writes.parseActionStatus(body));await assert.rejects(h.writes.updateActionStatus('bad',{status:'completed'}));assert.equal(h.counts().admins,0);
});
test('Mutation HTTP rejects cross-origin, oversized, malformed and unknown-body writes safely',async()=>{
 const h=harness(),http=load('src/lib/items/write-http.ts',{'@/lib/supabase/auth':h.auth,'./writes':h.writes});
 for(const [origin,body] of [['https://foreign.invalid','{}'],['http://localhost:3000','{'],['http://localhost:3000','x'.repeat(9000)]])await assert.rejects(http.readWriteBody(new Request('http://localhost:3000/api',{method:'PATCH',headers:{origin},body})));
 const r=http.writeErrorResponse(new AuthError());assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('Action GET validates type/status/deadline/limit and refuses unknown ownership parameters',()=>{
 const h=harness(),a=load('src/lib/items/actions.ts',{'@/lib/supabase/auth':h.auth,'@/lib/supabase/server':{},'./filters':filters,'./presentation':presentation,'./writes':h.writes});
 for(const q of ['userId=foreign','status=done','status=open&status=completed','limit=51','type=bad','deadlineStatus=guessed'])assert.throws(()=>a.parseActionQuery(new URLSearchParams(q)));
 assert.equal(a.parseActionQuery(new URLSearchParams('status=completed')).status,'completed');
});
const sourceItem=(source,format,metadata={})=>({source,format,content_text:content,metadata});
test('AI source eligibility accepts Gmail/Drive/manual/complete Upload, excludes Calendar/incomplete',()=>{
 assert.equal(policy.analysisEligible(sourceItem('gmail','email')),true);assert.equal(policy.analysisEligible(sourceItem('drive','document')),true);
 assert.equal(policy.analysisEligible(sourceItem('manual','text')),true);
 assert.equal(policy.analysisEligible(sourceItem('upload','pdf',{upload:{extraction:{status:'complete',version:'upload-text-v1'}}})),true);
 for(const v of [sourceItem('calendar','calendar_event'),sourceItem('upload','image'),sourceItem('drive','pdf'),{...sourceItem('gmail','email'),content_text:''}])assert.equal(policy.analysisEligible(v),false);
});
test('AI unchanged analysed skips; changed canonical text/model reanalyses, override does not affect fingerprint',()=>{
 const model='gemini-fixture',item=sourceItem('drive','document',{aiAnalysis:{schemaVersion:'0.2',model,inputFingerprint:policy.analysisFingerprint(content,model,"0.2")},user_primary_topic:'override'});
 assert.equal(policy.analysisCurrent(item,model),true);assert.equal(policy.analysisCurrent({...item,content_text:content+' changed'},model),false);assert.equal(policy.analysisCurrent(item,'gemini-other'),false);
});
test('bounded orchestration isolates provider failures, continues other ITEMs, no retry/backfill',async()=>{
 const calls=[],messages=[];const b=load('src/lib/items/browser-analysis.ts',{}, {fetch:async(url)=>{calls.push(url);return new Response('{}',{status:calls.length===2?503:200});}});
 const r=await b.runBoundedAnalysis(['a','b','c','d','a'],m=>messages.push(m));assert.equal(calls.length,3);assert.equal(r.complete,2);assert.equal(r.failed,1);assert.equal(r.pending,1);assert.ok(messages.at(-1).includes('자료는 저장되어 있습니다'));
});
test('analysis on already analysed ITEM does not invoke Gemini or privileged writes',async()=>{
 const validator=load('src/lib/gemini/validation.ts'),model='gemini-fixture';const item={id,...sourceItem('drive','document',{aiAnalysis:{schemaVersion:'0.2',model,inputFingerprint:policy.analysisFingerprint(content,model,'0.2'),result:validator.validateAnalysis(fixture(),content)}}),processing_status:'indexing'};
 const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:item};}};
 const a=load('src/lib/items/analysis.ts',{'@/lib/items/analysis-policy':policy,'@/lib/gemini/validation':validator,'@/lib/gemini/client':{GeminiAnalysisError:class extends Error{},getGeminiConfig:()=>({model}),analyzeGmailText:()=>{throw new Error('Should not call');}},'@/lib/items/filters':filters,'@/lib/supabase/auth':{requireUser:async()=>({id:'owner'})},'@/lib/supabase/server':{createClient:async()=>({from:()=>q})},'@/lib/supabase/admin':{createAdminClient:()=>{throw new Error('Should not write');}}});
 assert.equal((await a.analyzeOwnedItem(id)).cached,true);
});
for(const failure of ['429','503','timeout','malformed','validation','persistence'])test(`AI ${failure} preserves canonical ITEM and marks only its claim failed`,async()=>{
 const validator=load('src/lib/gemini/validation.ts'),item={id,...sourceItem('drive','document'),content_hash:null,updated_at:'old',processing_status:'queued'};
 const q={select(){return q;},eq(){return q;},limit(){return Promise.resolve({data:[]});},async maybeSingle(){return {data:{...item}};}};
 let failures=0; const admin={from(){let patch;const chain={update(v){patch=v;return chain;},eq(){return chain;},select(){return chain;},maybeSingle:async()=>({data:{updated_at:'claim'}}),then(resolve){if(patch.processing_status==='failed')failures++;return Promise.resolve({error:null}).then(resolve);}};return chain;},rpc:async()=>({error:{code:'23514'}})};
 const a=load('src/lib/items/analysis.ts',{'@/lib/items/analysis-policy':policy,'@/lib/gemini/validation':validator,'@/lib/gemini/client':{GeminiAnalysisError:class extends Error{},getGeminiConfig:()=>({model:'gemini-fixture'}),analyzeGmailText:async()=>{if(failure==='persistence')return validator.validateAnalysis(fixture(),content);throw new Error(failure);}},'@/lib/items/filters':filters,'@/lib/supabase/auth':{requireUser:async()=>({id:'owner'})},'@/lib/supabase/server':{createClient:async()=>({from:()=>q})},'@/lib/supabase/admin':{createAdminClient:()=>admin}});
 await assert.rejects(a.analyzeOwnedItem(id));assert.equal(item.content_text,content);assert.equal(item.id,id);assert.equal(failures,1);
});
