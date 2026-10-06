// Ephemeral actual PostgreSQL + pgvector. No network, secrets, remote data or provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSearch} from './search-loader.mjs';
const {PGlite}=await import('../supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite/dist/index.js');
const {vector}=await import('../supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite/dist/vector/index.js');
const db=new PGlite({extensions:{vector}}),c=loadSearch('src/lib/search/contract.ts'),ch=loadSearch('src/lib/search/chunker.ts');
const sql=readFileSync('supabase/migrations/20261005113838_search_contract_and_rpcs.sql','utf8');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const runtime=(op,p={},user=owner)=>scalar('select public.search_runtime($1,$2::uuid,$3::jsonb)',[op,user,JSON.stringify(p)]);
const index=(op,item,p={},attempt=null,user=owner,version=c.ACTIVE_EMBEDDING.version)=>scalar('select public.search_index($1,$2::uuid,$3::uuid,$4,$5::jsonb,$6::uuid)',[op,user,item,version,JSON.stringify(p),attempt]);
const filters={source:[],format:[],from:null,to:null};
const candidates=(q,{user=owner,version=c.ACTIVE_EMBEDDING.version,v=null,filter=filters,intent=c.searchIntent(q,Date.parse('2026-10-05T03:00:00Z'))}={})=>scalar('select public.search_candidates($1::uuid,$2,$3,$4::extensions.vector,$5::jsonb,$6::jsonb)',[user,version,q,v?JSON.stringify(v):null,JSON.stringify(filter),JSON.stringify(intent)]);
let checks=0;async function check(name,fn){await fn();checks++;console.log(`PASS: ${name}`);}
async function seed(n,source,title,text,user=owner,metadata={}) {await db.query('insert into public.items(id,user_id,title,content_text,source,format,metadata,source_created_at) values($1,$2,$3,$4,$5,$6,$7,\'2026-10-05T03:00:00Z\')',[id(n),user,title,text,source,source==='gmail'?'email':source==='calendar'?'calendar_event':source==='upload'?'pdf':'document',JSON.stringify(metadata)]);}
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema extensions;create schema auth;create extension vector with schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.users(id uuid primary key);
 create table public.items(id uuid primary key,user_id uuid not null references public.users(id),title text not null,content_text text,source text,format text,
 metadata jsonb not null default '{}',original_url text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source_created_at timestamptz,source_updated_at timestamptz,unique(id,user_id));
 create table public.actions(id uuid primary key,user_id uuid references public.users(id),title text,action_type text,status text default 'open',deadline_status text default 'none',deadline_date date,deadline_at timestamptz,
 deadline_source_id uuid,requirements text[] default '{}',conditions text[] default '{}',updated_at timestamptz default now(),unique(id,user_id));
 create table public.action_sources(id uuid primary key,user_id uuid,item_id uuid references public.items(id) on delete cascade,action_id uuid references public.actions(id) on delete cascade,evidence_text text,evidence_locator jsonb default '{}',is_current boolean default true);
 grant usage on schema private,public,extensions,auth to service_role;grant usage on schema public,auth to authenticated,anon;
 grant select,insert,update,delete on public.items,public.actions,public.action_sources to service_role;grant select on public.items,public.actions,public.action_sources to authenticated;
 alter table public.items enable row level security;create policy items_own on public.items to authenticated using(user_id=auth.uid());`);
 const base=readFileSync('0001_initial_schema (4).sql','utf8');
 await db.exec('set search_path=public,extensions');await db.exec(base.match(/create table public\.search_chunks \([\s\S]*?\n\);/)[0]);
 await db.exec(`create unique index search_chunks_item_chunk_uidx on public.search_chunks(item_id,chunk_index) where item_id is not null;
 alter table public.search_chunks enable row level security;create policy chunks_own on public.search_chunks to authenticated using(user_id=auth.uid());
 grant select on public.search_chunks to authenticated;grant select,insert,update,delete on public.search_chunks to service_role;`);
 await db.exec(sql);await db.exec(readFileSync('supabase/migrations/20261005121340_search_rank_ties.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261005115533_search_coverage.sql','utf8'));await db.query('insert into public.users values($1),($2)',[owner,other]);
 await seed(1,'gmail','농협 안내','농협 금융 지원. 정확한 원문 문구입니다. 😀');await seed(2,'drive','상담 자료','심리상담 프로그램 안내');
 await seed(3,'calendar','회의 일정','회의 장소 강의실',owner,{calendar:{start:{date:'2026-10-05'},end:{date:'2026-10-06'},allDay:true}});
 await seed(4,'upload','제출 PDF','PDF 원문 제출 자료');await seed(5,'upload','image OCR','이미지에서 추출한 한글 OCR');await seed(6,'gmail','농협 안내 타인','다른 사용자 secret',other);
 await check('exact title/phrase/Korean partial and all Unified sources, no-result, source/date filters',async()=>{
  assert.equal((await candidates('농협 안내'))[0].itemId,id(1));assert.equal((await candidates('정확한 원문 문구'))[0].itemId,id(1));assert.ok((await candidates('심리상')) .some(v=>v.itemId===id(2)));
  for(const [q,n]of [['회의',3],['PDF',4],['OCR',5]])assert.equal((await candidates(q))[0].itemId,id(n));
  assert.equal((await candidates('absentuniqueword')).length,0);assert.equal((await candidates('농협',{filter:{...filters,source:['drive']}})).length,0);
  assert.equal((await candidates('농협',{filter:{...filters,from:'2026-11-01'}})).length,0);assert.ok(!(await candidates('농협')).some(v=>v.itemId===id(6)));
  assert.equal((await candidates('회의',{filter:{...filters,from:'2026-10-06'}})).length,0);
 });
 const item=(await db.query('select * from public.items where id=$1',[id(2)])).rows[0],prepared=ch.chunkItem({...item,updated_at:item.updated_at.toISOString()}),vec=Array.from({length:768},(_,i)=>i===0?1:0);
 let attempt;
 await check('lease/CAS, independent chunk writes, source equality and atomic visibility',async()=>{
  const claim=await index('claim',id(2),{fingerprint:prepared.fingerprint,snapshot:item.updated_at.toISOString(),chunkCount:prepared.chunks.length,semantic:true});attempt=claim.attempt;
  await assert.rejects(()=>index('claim',id(2),{fingerprint:prepared.fingerprint,snapshot:item.updated_at.toISOString(),chunkCount:1,semantic:true}),e=>e.code==='55P03');
  await assert.rejects(()=>index('write',id(2),{chunk:{...prepared.chunks[0],content:'forged evidence'},embedding:JSON.stringify(vec)},attempt),e=>e.code==='22023');
  await index('write',id(2),{chunk:prepared.chunks[0],model:c.ACTIVE_EMBEDDING.model,embedding:JSON.stringify(vec)},attempt);
  assert.equal((await candidates('unrelated synonym',{v:vec})).length,0);await index('finish',id(2),{},attempt);
  assert.equal((await candidates('unrelated synonym',{v:vec}))[0].itemId,id(2));assert.equal((await index('claim',id(2),{fingerprint:prepared.fingerprint,snapshot:item.updated_at.toISOString(),chunkCount:1,semantic:true})).reused,true);
 });
 await check('only matching embeddingVersion is compared; Similar does not cross owner',async()=>{
  assert.equal((await candidates('unrelated synonym',{v:vec,version:'different-version'})).length,0);
  const similar=await scalar('select public.search_similar($1,$2,$3,5)',[other,id(2),c.ACTIVE_EMBEDDING.version]);assert.equal(similar.length,0);
  await assert.rejects(()=>index('read',id(2),{},null,other),e=>e.code==='P0002');
 });
 await check('own coverage excludes foreign and incomplete generations',async()=>{const result=await scalar('select public.search_coverage($1,$2)',[owner,c.ACTIVE_EMBEDDING.version]);assert.equal(result.totalItems,5);assert.equal(result.semanticIndexedItems,1);assert.equal((await scalar('select public.search_coverage($1,$2)',[other,c.ACTIVE_EMBEDDING.version])).semanticIndexedItems,0);});
 await check('exact title precedes partial title; source-date/id deterministically break keyword ties',async()=>{await seed(8,'drive','합성 순위계약','원문');await seed(9,'drive','합성 순위계약 추가','원문');await db.query("update public.items set source_updated_at='2026-10-09' where id=$1",[id(9)]);assert.equal((await candidates('합성 순위계약'))[0].itemId,id(8));await seed(10,'drive','합성 순위계약','원문');await db.query("update public.items set source_updated_at='2026-10-10' where id=$1",[id(10)]);assert.equal((await candidates('합성 순위계약'))[0].itemId,id(10));await db.query('delete from public.items where id=any($1::uuid[])',[[id(8),id(9),id(10)]]);});
 await check('Action intent uses confirmed deadlines plus current source evidence; no Action creation',async()=>{
  await db.query("insert into public.actions(id,user_id,title,action_type,deadline_status,deadline_date,deadline_source_id)values($1,$2,'서류 제출','required','confirmed','2026-10-06',$3)",[id(20),owner,id(21)]);
  await db.query("insert into public.action_sources(id,user_id,item_id,action_id,evidence_text)values($1,$2,$3,$4,'PDF 원문 제출 자료')",[id(21),owner,id(4),id(20)]);
  assert.equal((await candidates('내일까지'))[0].actionId,id(20));assert.equal((await candidates('이번 주 제출'))[0].actionId,id(20));
  assert.equal((await candidates('내일까지',{user:other})).length,0);
  await db.query("update public.actions set deadline_status='needs_review',deadline_date=null where id=$1",[id(20)]);assert.equal((await candidates('내일까지')).length,0);assert.equal((await candidates('해야 할 일')).length,1);
 });
 await check('Action completion excludes fresh SQL and stale snapshot; restore reappears',async()=>{
  const rows=await candidates('해야 할 일'),saved=await runtime('snapshot',{context:'status-change',version:c.ACTIVE_EMBEDDING.version,results:rows,info:{}});
  await db.query("update public.actions set status='completed',updated_at=now() where id=$1",[id(20)]);assert.equal((await candidates('해야 할 일')).length,0);
  assert.equal((await runtime('page',{session:saved.id,context:'status-change',version:c.ACTIVE_EMBEDDING.version,offset:0,limit:20})).results.length,0);
  await db.query("update public.actions set status='open',updated_at=now() where id=$1",[id(20)]);assert.equal((await candidates('해야 할 일')).length,1);
 });
 await check('snapshot pages are stable after insert and drop deleted/changed documents; owner-bound cursor',async()=>{
  const rows=await candidates('농협');const snapshot=await runtime('snapshot',{context:'test',version:c.ACTIVE_EMBEDDING.version,results:rows,info:{mode:'keyword_only'}});
  await seed(7,'gmail','농협 new','새 문서');const page={session:snapshot.id,context:'test',version:c.ACTIVE_EMBEDDING.version,offset:0,limit:20};
  assert.equal((await runtime('page',page)).results.length,1);await assert.rejects(()=>runtime('page',page,other),e=>e.code==='P0002');
  await db.query('delete from public.items where id=$1',[id(1)]);assert.equal((await runtime('page',page)).results.length,0);
 });
 await check('shared atomic rate budget, query-cache lease, version and user segregation',async()=>{
  for(let i=0;i<30;i++)assert.equal((await runtime('rate',{category:'request'})).allowed,true);assert.equal((await runtime('rate',{category:'request'})).allowed,false);assert.equal((await runtime('rate',{category:'request'},other)).allowed,true);
  const payload={key:c.hash('query'),version:c.ACTIVE_EMBEDDING.version},cl=await runtime('query_claim',payload);assert.equal(cl.state,'claimed');assert.equal((await runtime('query_claim',payload)).state,'busy');
  await runtime('query_finish',{...payload,attempt:cl.attempt,embedding:JSON.stringify(vec)});assert.equal((await runtime('query_claim',payload)).state,'cached');assert.equal((await runtime('query_claim',payload,other)).state,'claimed');
 });
 await check('stale ITEM and locator-only updates invalidate old semantic data; AI metadata does not queue',async()=>{
  await db.query("update public.items set metadata=jsonb_build_object('aiAnalysis',jsonb_build_object('safe',true)) where id=$1",[id(2)]);
  assert.equal((await index('read',id(2))).state,'complete');assert.equal((await candidates('unrelated synonym',{v:vec}))[0].itemId,id(2));
  await db.query("update public.items set content_text='새 원문',updated_at=now() where id=$1",[id(2)]);
  assert.equal((await index('read',id(2))).state,'pending');assert.equal((await candidates('unrelated synonym',{v:vec})).length,0);
  await assert.rejects(()=>index('write',id(2),{chunk:prepared.chunks[0],embedding:JSON.stringify(vec)},attempt),e=>e.code==='40001');
  const a=(await candidates('해야 할 일'))[0],snapshot=await runtime('snapshot',{context:'action-delete',version:c.ACTIVE_EMBEDDING.version,results:[a],info:{}});
  await db.query('delete from public.items where id=$1',[id(4)]);
  assert.equal((await runtime('page',{session:snapshot.id,context:'action-delete',version:c.ACTIVE_EMBEDDING.version,offset:0,limit:20})).results.length,0);
 });
 await check('anonymous/authenticated cannot invoke search RPCs or read private/raw vectors; RLS isolates chunks',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');
  await assert.rejects(()=>candidates('농협'),e=>e.code==='42501');await assert.rejects(()=>scalar('select count(*) from private.search_sessions'),e=>e.code==='42501');await assert.rejects(()=>scalar('select embedding from public.search_chunks'),e=>e.code==='42501');
  assert.equal(await scalar('select count(id)::int from public.search_chunks'),0);await db.exec('reset role;set role anon');await assert.rejects(()=>candidates('농협'),e=>e.code==='42501');await db.exec('reset role');
 });
 console.log(`Search SQL: ${checks} checks PASS (ephemeral pgvector; no external calls).`);
}finally{await db.close();}

