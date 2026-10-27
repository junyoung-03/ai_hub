import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const base=readFileSync('supabase/baseline/0001_initial_schema.sql','utf8');
const migration=readFileSync('supabase/migrations/20261013003636_manual_action_evidence_boundary.sql','utf8');
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333';
const get=async()=> (await db.query('select * from public.actions where id=$1',[id])).rows[0];
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS:',name);}
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.users(id uuid primary key);create table public.items(id uuid,user_id uuid,primary key(id,user_id));`);
 for(const name of ['action_type','action_status','deadline_status']) await db.exec(base.match(new RegExp('create type public\\.'+name+' as enum \\([\\s\\S]*?;'))[0]);
 for(const name of ['actions','action_sources']) await db.exec(base.match(new RegExp('create table public\\.'+name+' \\([\\s\\S]*?\\n\\);'))[0]);
 await db.exec(base.match(/create or replace function public\.assert_action_evidence\([\s\S]*?\$\$;/)[0]);
 await db.exec(base.match(/create or replace function public\.validate_action_evidence_trigger\(\)[\s\S]*?\$\$;/)[0]);
 for(const name of ['actions_require_evidence','action_sources_preserve_evidence']) await db.exec(base.match(new RegExp('create constraint trigger '+name+'[\\s\\S]*?;'))[0]);
 await db.exec(migration);
 await db.query('insert into public.users values($1),($2)',[owner,other]);
 const insert=(origin='manual')=>db.query(`insert into public.actions(id,user_id,title,action_type,origin,deadline_status,deadline_date,deadline_at) values($1,$2,'TEST','required',$3,'confirmed','2026-10-24','2026-10-24 14:00+09')`,[id,owner,origin]);
 await check('source-backed Action still rejects absent evidence',()=>assert.rejects(()=>insert('source'),/current evidence source/));
 await check('manual create persists without ITEM or source',async()=>{await insert();assert.equal((await get()).origin,'manual');assert.equal((await db.query('select count(*) n from public.action_sources')).rows[0].n,0);});
 await check('same ID title date time edit persists',async()=>{await db.query(`update public.actions set title='TEST EDIT',deadline_date='2026-10-25',deadline_at='2026-10-25 15:00+09' where id=$1`,[id]);assert.equal((await get()).title,'TEST EDIT');});
 await check('completed and reopened states persist',async()=>{await db.query(`update public.actions set status='completed',completed_at=now() where id=$1`,[id]);assert.equal((await get()).status,'completed');await db.query(`update public.actions set status='open',completed_at=null where id=$1`,[id]);assert.equal((await get()).status,'open');});
 await check('origin cannot be changed to evade evidence policy',()=>assert.rejects(()=>db.query(`update public.actions set origin='source' where id=$1`,[id]),/immutable/));
 await check('manual cannot acquire fake evidence',async()=>{await db.query('insert into public.items values($1,$2)',[id,owner]);await assert.rejects(()=>db.query(`insert into public.action_sources(user_id,action_id,item_id,evidence_text) values($1,$2,$2,'fake')`,[owner,id]),/must not contain source/);});
 await db.exec(`alter table public.actions enable row level security;grant usage on schema public,auth to authenticated;grant select on public.actions to authenticated;create policy actions_select_own on public.actions for select to authenticated using(user_id=auth.uid());`);
 await check('owner sees own row; other user sees zero; browser cannot write',async()=>{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${other}',false)`);assert.equal((await db.query('select * from public.actions')).rows.length,0);await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);assert.equal((await db.query('select * from public.actions')).rows.length,1);await assert.rejects(()=>db.query(`delete from public.actions where id=$1`,[id]),/permission denied/);await db.exec('reset role');});
 await check('manual delete removes Action without removing ITEM',async()=>{await db.query('delete from public.actions where id=$1',[id]);assert.equal(await get(),undefined);assert.equal((await db.query('select * from public.items')).rows.length,1);});
 console.log(`${checks} SQL checks passed`);
} finally {await db.close();}
