// Actual draft SQL on an ephemeral PostgreSQL/WASM database. No .env or remote connection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './helpers/calendar-loader.mjs';
const {PGlite}=await import('../supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite/dist/index.js');
const db=new PGlite(),c=load('src/lib/uploads/contract.ts');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const base=readFileSync(new URL('../supabase/baseline/0001_initial_schema.sql',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261005070410_upload_storage_session_boundary.sql',import.meta.url),'utf8');
const followup=readFileSync(new URL('../supabase/migrations/20261005093526_upload_provider_neutral_rpc.sql',import.meta.url),'utf8');
const cpuFix=readFileSync(new URL('../supabase/migrations/20261010011615_upload_stale_attempt_nonretryable.sql',import.meta.url),'utf8');
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const rpc=async(op,id=null,{user=owner,key=crypto.randomUUID(),request={fileName:'fixture.pdf',mimeType:'application/pdf',size:100},payload=null,attempt=null}={})=>scalar('select public.upload_session_rpc($1,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6::jsonb,$7::uuid)',[op,user,id,key,JSON.stringify(request),JSON.stringify(payload),attempt]);
const raw=c.sha256('synthetic raw bytes'),text=c.assemble([{text:'Synthetic 😀',method:'embedded',confidence:null}]);
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log(`PASS: ${name}`);};
const reject=async(fn,code)=>{await assert.rejects(fn,error=>error.code===code);};
try{
  await db.exec("create role anon;create role authenticated;create role service_role;create schema private;create schema auth;create schema storage;create table public.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema public,storage,auth to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;");
  for(const name of ['connection_provider','connection_status','item_source','item_format','processing_status'])await db.exec(base.match(new RegExp(`create type public\\.${name} as enum \\([\\s\\S]*?;`))[0]);
  for(const name of ['connections','items'])await db.exec(base.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?;`))[0]);
  await db.exec(base.match(/create or replace function public\.set_updated_at\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec(base.match(/create trigger items_set_updated_at[\s\S]*?;/)[0]);
  await db.exec("alter table public.items enable row level security;grant select on public.items to authenticated,anon;create policy fixture_items_owner on public.items for select to authenticated using(user_id=auth.uid());create table public.classifications(item_id uuid,user_tags text[]);create table public.actions(id int,status text);create table public.action_sources(id int,evidence text);");
  await db.exec(sql);await db.exec(followup);
  const contractBefore=await scalar("select jsonb_build_object('args',pg_get_function_identity_arguments(oid),'result',pg_get_function_result(oid),'security',prosecdef,'config',proconfig,'acl',proacl::text,'owner',proowner) from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure");
  await db.exec(cpuFix);
  const contractAfter=await scalar("select jsonb_build_object('args',pg_get_function_identity_arguments(oid),'result',pg_get_function_result(oid),'security',prosecdef,'config',proconfig,'acl',proacl::text,'owner',proowner) from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure");
  assert.deepEqual(contractAfter,contractBefore);
  const fixedBody=await scalar("select prosrc from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure");
  assert.equal(fixedBody,followup.split('$$')[1].replaceAll("raise exception 'STALE_ATTEMPT' using errcode='40001'","raise sqlstate 'PT409' using message='STALE_ATTEMPT'"));
  await db.exec(cpuFix);assert.equal(await scalar("select prosrc from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure"),fixedBody);await db.query('insert into public.users values($1),($2)',[owner,other]);
  await check('existing enum supports uploaded/queued/extracting; draft bucket is private and capped',async()=>{const values=await scalar("select enum_range(null::public.processing_status)::text");for(const v of ['uploaded','queued','extracting'])assert.ok(values.includes(v));assert.equal(await scalar("select public from storage.buckets where id='upload-originals'"),false);});
  const key=crypto.randomUUID();const a=await rpc('create',null,{key});
  await check('idempotency replay reuses session; different request conflicts; owner is required',async()=>{assert.equal((await rpc('create',null,{key})).id,a.id);await reject(()=>rpc('create',null,{key,request:{fileName:'other.pdf',mimeType:'application/pdf',size:100}}),'23505');await reject(()=>rpc('read',a.id,{user:other}),'22023');await reject(()=>rpc('create',null,{request:{fileName:'../x.pdf',mimeType:'application/pdf',size:100}}),'22023');});
  let pending=await rpc('pending',a.id,{payload:{rawHash:raw}});
  const item=async()=> (await db.query('select * from public.items where id=$1',[pending.itemId])).rows[0];
  await check('pending has server UUID, null Google identity, canonical path and queued state',async()=>{const r=await item();assert.equal(r.external_id,a.id);assert.equal(r.source,'upload');assert.equal(r.format,'pdf');for(const name of ['connection_id','external_container_id','original_url','content_text','content_hash'])assert.equal(r[name],null);assert.equal(r.storage_path,c.uploadPath(owner,a.id,'application/pdf'));assert.equal(r.processing_status,'queued');});
  const b=await rpc('create',null,{request:{fileName:'renamed.pdf',mimeType:'application/pdf',size:100}});
  await check('same bytes different filename reuse; same filename different bytes create; other users isolated',async()=>{
    await reject(()=>rpc('pending',b.id,{payload:{rawHash:raw}}),'55P03');
    const fresh=await rpc('create');assert.notEqual((await rpc('pending',fresh.id,{payload:{rawHash:c.sha256('different')}})).itemId,pending.itemId);
    const foreign=await rpc('create',null,{user:other});assert.notEqual((await rpc('pending',foreign.id,{user:other,payload:{rawHash:raw}})).itemId,pending.itemId);
  });
  await db.query('insert into public.classifications values($1,array[\'User Edited\'])',[pending.itemId]);await db.exec("insert into public.actions values(1,'completed');insert into public.action_sources values(1,'preserve');");
  const graph=async()=>JSON.stringify((await db.query('select (select jsonb_agg(c) from public.classifications c)c,(select jsonb_agg(a)from public.actions a)a,(select jsonb_agg(e)from public.action_sources e)e')).rows);const before=await graph();
  let claim=await rpc('claim',a.id);
  await check('active lease serializes; malformed extraction and stale attempt reject atomically',async()=>{
    await reject(()=>rpc('claim',a.id),'55P03');await reject(()=>rpc('finish',a.id,{attempt:crypto.randomUUID(),payload:text}),'PT409');
    for(const payload of [{...text,hash:'0'.repeat(64)},{...text,pages:[{...text.pages[0],start:1}]},{...text,pages:[{...text.pages[0],end:null}]},{...text,pages:[{...text.pages[0],credential:'unsafe'}]}])await reject(()=>rpc('finish',a.id,{attempt:claim.attempt,payload}),'22023');
    assert.equal((await item()).content_text,null);
  });
  await check('failure stores no partial text; retry finishes with matching lease/CAS, preserving user graph',async()=>{
    await rpc('fail',a.id,{attempt:claim.attempt,payload:{error:'OCR_FAILED'}});assert.equal((await item()).processing_status,'failed');assert.equal((await item()).content_text,null);
    claim=await rpc('claim',a.id);await rpc('finish',a.id,{attempt:claim.attempt,payload:text});const r=await item();assert.equal(r.content_text,text.text);assert.equal(r.content_hash,text.hash);assert.notEqual(r.content_hash,raw);assert.equal(r.processing_status,'queued');assert.equal(r.metadata.upload.extraction.status,'complete');assert.equal(await graph(),before);
    const stamp=r.updated_at;assert.equal((await rpc('claim',a.id)).state,'complete');assert.deepEqual((await item()).updated_at,stamp);
    assert.equal((await rpc('pending',b.id,{payload:{rawHash:raw}})).itemId,pending.itemId);
  });
  await check('expired attempts and ITEM snapshot changes cannot finish; raw hash mismatch blocked',async()=>{
    const t=await rpc('create'),p=await rpc('pending',t.id,{payload:{rawHash:c.sha256('lease fixture')}}),cl=await rpc('claim',t.id);
    await db.query("update private.upload_sessions set lease_until=now()-interval '1 second' where id=$1",[t.id]);await reject(()=>rpc('finish',t.id,{attempt:cl.attempt,payload:text}),'PT409');
    const next=await rpc('claim',t.id);await reject(()=>rpc('finish',t.id,{attempt:cl.attempt,payload:text}),'PT409');await db.query("update public.items set title='edited' where id=$1",[p.itemId]);await reject(()=>rpc('finish',t.id,{attempt:next.attempt,payload:text}),'PT409');await reject(()=>rpc('pending',t.id,{payload:{rawHash:raw},attempt:next.attempt}),'22023');
  });
  await check('private session/RPC access and Storage owner RLS enforce exact path, no update/delete',async()=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
    assert.equal(await scalar('select public.owns_upload_object($1,false)',[a.path]),true);assert.equal(await scalar('select public.owns_upload_object($1,false)',[`${owner}/../original.pdf`]),false);
    await reject(()=>rpc('read',a.id),'42501');await reject(()=>scalar('select count(*) from private.upload_sessions'),'42501');
    await db.exec('reset role');await db.query('insert into storage.objects(bucket_id,name)values(\'upload-originals\',$1)',[a.path]);await db.exec('set role authenticated');assert.equal(await scalar('select count(*)::int from storage.objects'),1);assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');assert.equal(await scalar('select count(*)::int from storage.objects'),0);assert.equal(await scalar('select public.owns_upload_object($1,false)',[a.path]),false);await db.exec('reset role');
    const s=await rpc('create');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');await db.query("insert into storage.objects(bucket_id,name)values('upload-originals',$1)",[s.path]);await reject(()=>db.query("insert into storage.objects(bucket_id,name)values('upload-originals',$1)",[s.path.replace('original.pdf','arbitrary.pdf')]),'42501');assert.equal((await db.query("update storage.objects set name='changed' returning name")).rows.length,0);await db.exec('reset role');
  });
  await check('cleanup respects issued token window and ITEM references, claims exact orphan with CAS',async()=>{
    const s=await rpc('create');await rpc('issue',s.id);await reject(()=>rpc('cleanup_claim',s.id),'22023');await db.query("update private.upload_sessions set cleanup_after=now()-interval '1 second' where id in ($1,$2)",[s.id,a.id]);await reject(()=>rpc('cleanup_claim',a.id),'22023');
    const cl=await rpc('cleanup_claim',s.id);await reject(()=>rpc('pending',s.id,{payload:{rawHash:c.sha256('orphan')}}),'PT409');await reject(()=>rpc('cleanup_done',s.id,{attempt:crypto.randomUUID()}),'PT409');await rpc('cleanup_done',s.id,{attempt:cl.attempt});assert.equal((await rpc('read',s.id)).state,'cleaned');
  });
  await check('global reservation bounds the whole Storage/parser/OCR run across users, with safe release',async()=>{
    await db.exec("update private.upload_sessions set lease_until=now()-interval '1 second' where lease_until is not null");
    const x=await rpc('create'),y=await rpc('create',null,{user:other});
    const reserved=await rpc('reserve',x.id,{payload:{leaseMs:10000}});
    await reject(()=>rpc('reserve',y.id,{user:other}),'55P03');await reject(()=>rpc('reserve',x.id),'55P03');
    await reject(()=>rpc('release',x.id,{attempt:crypto.randomUUID()}),'PT409');await rpc('release',x.id,{attempt:reserved.attempt});
    const otherReserve=await rpc('reserve',y.id,{user:other});await rpc('release',y.id,{user:other,attempt:otherReserve.attempt});
  });
  await check('image mapping requires exactly one OCR range; completed RPC cannot accept embedded image text',async()=>{
    const s=await rpc('create',null,{request:{fileName:'fixture.jpeg',mimeType:'image/jpeg',size:100}});
    const p=await rpc('pending',s.id,{payload:{rawHash:c.sha256('image raw fixture')}}),cl=await rpc('claim',s.id);
    await reject(()=>rpc('finish',s.id,{attempt:cl.attempt,payload:text}),'22023');
    const imageText=c.assemble([{text:'Mock image text',method:'ocr',confidence:0.01}]);await rpc('finish',s.id,{attempt:cl.attempt,payload:imageText});
    const r=(await db.query('select * from public.items where id=$1',[p.itemId])).rows[0];assert.equal(r.format,'image');assert.equal(r.storage_path,`${owner}/${s.id}/original.jpg`);assert.equal(r.metadata.upload.extraction.pages[0].confidence,0.01);
  });
  await check('provider-neutral RPC rejects forged origin/version/language and extra metadata without partial writes',async()=>{
    const s=await rpc('create',null,{request:{fileName:'fixture.png',mimeType:'image/png',size:100}}),p=await rpc('pending',s.id,{payload:{rawHash:c.sha256('metadata fixture')}}),cl=await rpc('claim',s.id);
    const value=c.assemble([{text:'한글 English',method:'ocr',confidence:0.01}]);
    for(const delta of [{provider:'arbitrary'},{execution:'server'},{providerVersion:'999'},{language:'eng'},{start:1},{storagePath:'fake'}])await reject(()=>rpc('finish',s.id,{attempt:cl.attempt,payload:{...value,pages:[{...value.pages[0],...delta}]}}),'22023');
    for(const delta of [{method:'embedded'},{execution:'server'},{provider:'cloud-vision'},{language:null},{providerVersion:'999'},{rawOutput:'unsafe'}])await reject(()=>rpc('finish',s.id,{attempt:cl.attempt,payload:{...value,...delta}}),'22023');
    assert.equal(await scalar('select content_text from public.items where id=$1',[p.itemId]),null);await rpc('finish',s.id,{attempt:cl.attempt,payload:value});
  });
  await check('browser pause holds no lease; expired running attempt recovers with fresh CAS and rejects old writer',async()=>{
    const x=await rpc('create'),res=await rpc('reserve',x.id),p=await rpc('pending',x.id,{attempt:res.attempt,payload:{rawHash:c.sha256('browser pause fixture')}});await rpc('release',x.id,{attempt:res.attempt});
    assert.equal(await scalar('select lease_until is null and attempt is null from private.upload_sessions where id=$1',[x.id]),true);
    const cl=await rpc('claim',x.id);await db.query("update private.upload_sessions set lease_until=now()-interval '1 second' where id=$1",[x.id]);const recovered=await rpc('reserve',x.id);assert.equal(recovered.state,'failed');await rpc('release',x.id,{attempt:recovered.attempt});
    const next=await rpc('claim',x.id);await reject(()=>rpc('finish',x.id,{attempt:cl.attempt,payload:text}),'PT409');await rpc('finish',x.id,{attempt:next.attempt,payload:text});assert.equal(await scalar('select content_text from public.items where id=$1',[p.itemId]),text.text);
  });
  console.log(`Upload SQL: ${checks} checks PASS (ephemeral PostgreSQL, no remote writes)`);
}catch(error){console.error('Upload SQL failed:',error.code??'ASSERTION',error.message,error.position,error.internalPosition,error.internalQuery?.slice(Math.max(0,Number(error.internalPosition)-100),Number(error.internalPosition)+100));process.exitCode=1;}
finally{await db.close();}
