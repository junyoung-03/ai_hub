import test from 'node:test';
import assert from 'node:assert/strict';
import { uiLoader } from './content-ui-loader.mjs';
import { isolatedInspect } from '../workers/upload/isolate.mjs';
import { pdfFixture } from './upload-fixtures.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
const id='11111111-1111-4111-8111-111111111111';
class ItemWriteError extends Error { constructor(code,status=400){super(code);this.code=code;this.status=status;} }
function harness({foreign=false,sourced=false,anonymous=false,conflict=false}={}) {
  let row=null, adminCalls=0;
  const source={id:'source',action_id:id,user_id:'owner'};
  function from(table){
    const predicates=[];let patch,removing=false,inserting=false;
    const q={select(){return q;},eq(key,v){predicates.push([key,v]);return q;},limit(){return q;},
      insert(v){patch=v;inserting=true;return q;},update(v){patch=v;return q;},delete(){removing=true;return q;},
      async single(){return q.maybeSingle();},async maybeSingle(){
        if(inserting){row={...patch,id,updated_at:'version-1',created_at:'2026-10-13',completed_at:null};return {data:{...row}};}
        if(!row||predicates.some(([k,v])=>row[k]!==v))return {data:null};
        if((patch||removing)&&conflict)return {data:null};
        const result={...row,...patch};
        if(removing)row=null;else if(patch)row={...result,updated_at:row.updated_at+'x'};
        return {data:{...result}};
      },then(resolve){return Promise.resolve({data:table==='action_sources'&&sourced?[source]:[]}).then(resolve);}};
    return q;
  }
  const load=uiLoader({'@/lib/items/writes':{ItemWriteError},'./writes':{ItemWriteError},
    '@/lib/supabase/auth':{requireUser:async()=>{if(anonymous)throw new Error('AUTH');return {id:foreign?'other':'owner'};}},
    '@/lib/supabase/server':{createClient:async()=>({from})},'@/lib/supabase/admin':{createAdminClient:()=>{adminCalls++;return {from};}}});
  return {create:load('src/lib/items/manual-action.ts').createManualAction,
    mutations:load('src/lib/items/action-mutations.ts'), parse:load('src/lib/items/action-input.ts').parseActionInput,
    read:()=>row?{...row}:null, calls:()=>adminCalls, seed:()=>{row={id,user_id:'owner',updated_at:'version-1',title:'TEST',origin:sourced?'source':'manual',deadline_date:'2026-10-24',deadline_at:'2026-10-24T14:00:00+09:00',status:'open'};}};
}
test('Planner create uses only an Action and the authenticated owner, with persistent returned ID',async()=>{
  const h=harness(),r=await h.create({title:' TEST ',date:'2026-10-24',time:'14:00'});
  assert.equal(r.action.actionId,id); assert.equal(h.read().user_id,'owner'); assert.equal(h.read().origin,'manual'); assert.equal(h.read().title,'TEST'); assert.equal(r.action.sources.length,0);
});
test('Planner edit updates the same Action title/date/time; reread retains values',async()=>{
  const h=harness();h.seed();await h.mutations.updateManualAction(id,{title:'TEST EDIT',date:'2026-10-25',time:'15:00'});
  const stored=h.read();assert.equal(stored.id,id);assert.equal(stored.title,'TEST EDIT');assert.equal(stored.deadline_date,'2026-10-25');assert.equal(stored.deadline_at,'2026-10-25T15:00:00+09:00');assert.equal(h.read().title,stored.title);
});
test('Planner delete removes only the selected owned Action; reread remains absent',async()=>{
  const h=harness();h.seed();assert.equal((await h.mutations.deleteManualAction(id)).deleted,true);assert.equal(h.read(),null);
});
for(const mode of ['foreign','anonymous'])test(`Planner edit/delete ${mode} cannot reach privileged writer`,async()=>{
  const h=harness({[mode]:true});h.seed();await assert.rejects(h.mutations.updateManualAction(id,{title:'bad',date:'2026-10-25',time:null}));await assert.rejects(h.mutations.deleteManualAction(id));assert.equal(h.calls(),0);assert.equal(h.read().title,'TEST');
});
test('Source-backed Actions retain Evidence: edit/delete require reviewed override contract',async()=>{
  const h=harness({sourced:true});h.seed();await assert.rejects(h.mutations.updateManualAction(id,{title:'bad',date:'2026-10-25',time:null}),{code:'CONFLICT'});await assert.rejects(h.mutations.deleteManualAction(id),{code:'CONFLICT'});assert.equal(h.calls(),0);
});
test('Planner lost update/delete returns conflict rather than silent success',async()=>{
  const h=harness({conflict:true});h.seed();await assert.rejects(h.mutations.updateManualAction(id,{title:'TEST',date:'2026-10-25',time:null}),{code:'CONFLICT'});await assert.rejects(h.mutations.deleteManualAction(id),{code:'CONFLICT'});
});
test('Create/edit validation rejects impossible dates, malformed times and ownership fields',()=>{
  const h=harness();for(const extra of [{date:'2026-02-30'},{time:'24:00'},{time:'12:60'},{user_id:'foreign'},{title:'\u0000bad'}]) assert.throws(()=>h.parse({title:'TEST',date:'2026-10-24',time:null,...extra}));assert.equal(h.parse({title:'TEST',date:'2028-02-29',time:null}).deadlineAt,null);
});
test('Upload child path includes parser sibling and child environment excludes provider credentials',async()=>{
  const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='synthetic-test-secret';
  try {await isolatedInspect(pdfFixture(), 'application/pdf',{_fork(path,args,options){
    assert.ok(existsSync(resolve(dirname(path),'parser.mjs')));assert.equal(options.env.GEMINI_API_KEY,undefined);assert.equal(options.env.SUPABASE_SECRET_KEY,undefined);
    const child=new EventEmitter();child.kill=()=>{};child.send=()=>queueMicrotask(()=>child.emit('message',{result:{pages:[]}}));return child;
  }});} finally {if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
