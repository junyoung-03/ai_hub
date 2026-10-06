// Full v0.5 schema + existing atomic analysis + approved additive RPC in ephemeral PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '../supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite/dist/index.js';
import {vector} from '../supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite/dist/vector/index.js';
import {fixture,content} from './analysis-fixtures.mjs';
import {loadAnalysisModule} from './analysis-loader.mjs';
const db=new PGlite({extensions:{vector}});
const base=readFileSync('0001_initial_schema (4).sql','utf8');
const result=loadAnalysisModule('src/lib/gemini/validation.ts').validateAnalysis(fixture(),content);
const user='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const persist=(id,owner=user,analysis=result,text=content)=>scalar('select public.persist_eligible_item_analysis($1::uuid,$2::uuid,$3,null,$4::jsonb,$5,$6)',[owner,id,text,JSON.stringify(analysis),'gemini-fixture','a'.repeat(64)]);
let checks=0; const check=async(name,fn)=>{await fn();checks++;console.log('PASS: '+name);};
try {
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;");
 await db.exec(base);
 await db.exec(readFileSync('supabase/migrations/20261004115419_persist_gmail_item_analysis.sql','utf8'));
 const oldBody=await scalar("select prosrc from pg_proc where oid='public.persist_gmail_item_analysis(uuid,uuid,text,text,jsonb,text,text)'::regprocedure");
 await db.exec(readFileSync('supabase/migrations/20261005162738_persist_eligible_item_analysis.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261006000216_restrict_eligible_analysis_to_drive_upload.sql','utf8'));
 await db.query("insert into auth.users values($1,'gap-owner@example.invalid','{}'),($2,'gap-other@example.invalid','{}')",[user,foreign]);
 const connection=await scalar("insert into public.connections(user_id,provider,status,provider_account_id) values($1,'google','connected','synthetic') returning id",[user]);
 const seed=async(source,format,metadata={})=>scalar('insert into public.items(user_id,source,format,title,content_text,processing_status,metadata,connection_id,external_id,external_container_id,storage_path) values($1,$2,$3,$4,$5,\'queued\',$6::jsonb,$7,$8,$9,$10) returning id',[user,source,format,'Synthetic',content,JSON.stringify(metadata),source==='upload'?null:connection,source==='upload'?null:crypto.randomUUID(),source==='calendar'?'primary':null,source==='upload'?user+'/'+crypto.randomUUID()+'/fixture.pdf':null]);
 const drive=await seed('drive','document'),upload=await seed('upload','pdf',{upload:{extraction:{version:'upload-text-v1',status:'complete'}}});
 const calendar=await seed('calendar','calendar_event'),incomplete=await seed('upload','image'),gmail=await seed('gmail','email');
 await check('additive DDL preserves Gmail function and only service_role has EXECUTE',async()=>{
  assert.equal(await scalar("select prosrc from pg_proc where oid='public.persist_gmail_item_analysis(uuid,uuid,text,text,jsonb,text,text)'::regprocedure"),oldBody);
  for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)','execute')`),false);
  assert.equal(await scalar("select has_function_privilege('service_role','public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)','execute')"),true);
 });
 await check('Drive/complete Upload atomic Classification/Action/Evidence persistence',async()=>{
  assert.equal((await persist(drive)).created_count,1);assert.equal((await persist(upload)).created_count,1);
  assert.equal(await scalar('select count(*)::int from public.actions'),2);
  assert.equal(await scalar('select count(*)::int from public.action_sources'),2);
 });
 await check('cached repeat creates no duplicate Action or Evidence',async()=>{
  assert.equal((await persist(drive)).cached,true);assert.equal(await scalar('select count(*)::int from public.action_sources'),2);
 });
 await check('User override and completed Action survive changed AI classification',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');
  await db.query("select public.set_classification_override($1,'사용자 주제','general',array['보호'])",[drive]);await db.exec('reset role');
  await db.query("update public.actions set status='completed',completed_at=now() where id=(select action_id from public.action_sources where item_id=$1)",[drive]);
  const edited=structuredClone(result);edited.classification.primaryTopic='Changed AI';await persist(drive,user,edited);
  assert.equal(await scalar('select user_primary_topic from public.classifications where item_id=$1',[drive]),'사용자 주제');
  assert.equal(await scalar('select ai_primary_topic from public.classifications where item_id=$1',[drive]),'Changed AI');
  assert.equal(await scalar('select status from public.actions where id=(select action_id from public.action_sources where item_id=$1)',[drive]),'completed');
  assert.equal(await scalar('select count(*)::int from public.action_sources'),2);
 });
 await check('Gmail/Calendar/incomplete extraction/foreign/stale canonical input rejected by Drive/Upload RPC',async()=>{
  for(const id of [gmail,calendar,incomplete])await assert.rejects(persist(id),e=>e.code==='P0002');
  await assert.rejects(persist(drive,foreign),e=>e.code==='P0002');
  await assert.rejects(persist(drive,user,result,content+' changed'),e=>e.code==='22023');
  assert.equal(await scalar('select count(*)::int from public.classifications'),2);
 });
 await check('malformed second Action rolls back first Action/Classification but preserves ITEM',async()=>{
  const id=await seed('drive','document'),bad=structuredClone(result);bad.actions.push({...bad.actions[0],title:'다른 제출',actionType:'invalid'});
  await assert.rejects(persist(id,user,bad));
  assert.equal(await scalar('select count(*)::int from public.classifications where item_id=$1',[id]),0);
  assert.equal(await scalar('select processing_status from public.items where id=$1',[id]),'queued');
  assert.equal(await scalar('select count(*)::int from public.actions'),2);
 });
 await check('existing RLS blocks foreign/anonymous read and existing override RPC blocks foreign write',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[foreign]);await db.exec('set role authenticated');
  assert.equal(await scalar('select count(*)::int from public.classifications'),0);
  await assert.rejects(db.query("select public.set_classification_override($1,'Foreign','general','{}')",[drive]));await db.exec('reset role');
  await db.exec('set role anon');await assert.rejects(persist(drive),e=>e.code==='42501');await db.exec('reset role');
 });
 console.log(`PASS: ${checks} isolated DB checks; no remote writes/provider calls.`);
} finally {await db.close();}
