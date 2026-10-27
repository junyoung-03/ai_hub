// Actual bounded dev backfill. Only dedicated synthetic principals; exact cleanup is handled by test-search-live.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {randomUUID,randomBytes} from 'node:crypto';
import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import {loadSearch} from './helpers/search-loader.mjs';
nextEnv.loadEnvConfig(process.cwd());const url=process.env.NEXT_PUBLIC_SUPABASE_URL;assert.equal(new URL(url).hostname,'oclzdppdiljbojvqtkeu.supabase.co');assert.equal(process.env.SEARCH_E2E_PROJECT,'oclzdppdiljbojvqtkeu');
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),path='supabase/.temp/search3-live.json',s=JSON.parse(readFileSync(path,'utf8'));const save=()=>writeFileSync(path,JSON.stringify(s));
const ok=async(p,label)=>{const r=await p;assert.ok(!r.error,label);return r.data;};
let stage='setup';try{
 for(const mode of ['semantic','lexical']){
  if(s.checks.includes('backfill '+mode))continue;stage='backfill '+mode;
  let p=s.users.find(v=>v.backfill===mode);if(!p){const email=`search3-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');const data=await ok(admin.auth.admin.createUser({email,password,email_confirm:true}),'dedicated synthetic principal');p={id:data.user.id,email,password,backfill:mode};s.users.push(p);save();
   for(let n=0;n<5;n++){const text=mode==='lexical'&&n===0?'합성 긴 자료. '.repeat(1100):`합성 backfill 자료 ${n} 지리 수업 준비 안내`;const id=randomUUID();await ok(admin.from('items').insert({id,user_id:p.id,title:`합성 ${mode} backfill ${n}`,source:'manual',format:'text',content_text:text,metadata:{search3Synthetic:true}}),'backfill fixture');s.items.push({id,user_id:p.id,label:`backfill-${mode}-${n}`,title:`합성 ${mode} backfill ${n}`,content_text:text,source:'manual',format:'text',metadata:{search3Synthetic:true}});save();}
  }
  const own=s.items.filter(i=>i.user_id===p.id);assert.equal(own.length,5);process.env.SEARCH_SEMANTIC_ENABLED=String(mode==='semantic');process.env.SEARCH_NON_SENSITIVE_ITEM_IDS=mode==='semantic'?own.map(i=>i.id).join(','):'';
  let transportCalls=0,active=0,maxActive=0,failFirst=mode==='semantic';
  const transport=async(i,o)=>{if(String(i).startsWith('https://generativelanguage.googleapis.com/')){transportCalls++;active++;maxActive=Math.max(maxActive,active);try{const payload=JSON.parse(o.body);assert.equal(payload.content.parts.length,1);assert.ok(payload.content.parts[0].text.startsWith('title: 합성 '));assert.equal(payload.embedContentConfig.outputDimensionality,768);if(failFirst){failFirst=false;return new Response('',{status:429,headers:{'Retry-After':'1'}});}return await fetch(i,o);}finally{active--;}}return fetch(i,o);};
  const runner=loadSearch('src/lib/search/backfill.ts',{'@/lib/supabase/auth':{requireUser:async()=>({id:p.id})},'@/lib/supabase/admin':{createAdminClient:()=>admin}},{fetch:transport});
  const dates=await ok(admin.from('items').select('created_at').eq('user_id',p.id),'fixture server timestamps');let progress=p.progress??{startedAt:new Date(Math.max(...dates.map(v=>Date.parse(v.created_at)))+1000).toISOString(),after:null,pending:[],failed:[],done:false};let cycles=0,observedPending=false,observedFailure=false;
  while(!progress.done&&cycles<5){const r=await runner.backfillCycle(progress,mode==='lexical');cycles++;observedPending||=r.pendingCount>0;observedFailure||=r.failedCount>0;assert.ok(r.completed+r.skipped+r.pendingCount+r.failedCount<=5);progress=r.progress;p.progress=progress;save();
   if(mode==='lexical'&&r.pendingCount){const job=await ok(admin.rpc('search_index',{p_op:'read',p_user_id:p.id,p_item_id:progress.pending[0],p_version:loadSearch('src/lib/search/contract.ts').ACTIVE_EMBEDDING.version}),'partial job');assert.equal(job.nextChunk,8);assert.ok(job.chunkCount>8);const coverage=await ok(admin.rpc('search_coverage',{p_user_id:p.id,p_version:loadSearch('src/lib/search/contract.ts').ACTIVE_EMBEDDING.version}),'partial coverage');assert.equal(coverage.semanticIndexedItems,0);}
   console.log(`PASS: synthetic ${mode} bounded cycle ${cycles}; completed=${r.completed}, pending=${r.pendingCount}, failed=${r.failedCount}`);
   if(progress.pending.length||progress.failed.length)await new Promise(x=>setTimeout(x,60000));
  }
  assert.equal(progress.done,true);if(mode==='semantic'){assert.equal(observedFailure,true);assert.equal(transportCalls,6);assert.equal(maxActive,1);}else{assert.equal(observedPending,true);assert.equal(transportCalls,0);}
  const rows=await ok(admin.from('search_chunks').select('embedding,item_id').eq('user_id',p.id),'backfill chunks');assert.equal(new Set(rows.map(v=>v.item_id)).size,5);assert.ok(rows.every(v=>mode==='semantic'?JSON.parse(v.embedding).length===768:v.embedding===null));
  p.backfillResult={cycles,transportCalls,maxActive,observedPending,observedFailure};s.checks.push('backfill '+mode);save();console.log(`PASS: synthetic ${mode} backfill resume/idempotency/progress; five ITEM batch, no private source.`);
 }
}catch(e){console.error(`FAIL: ${stage}; ${e instanceof assert.AssertionError?e.message:'details suppressed'}; credentials/content suppressed.`);process.exitCode=1;}
