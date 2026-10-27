// Offline Drive persistence/scope conflict regression; ephemeral PostgreSQL, no providers or remote data.
// The engine is a temporary test tool, deliberately absent from product dependencies.
import assert from "node:assert/strict";
import {applyConflictMigration} from "../scripts/rpc-conflicts-migration.mjs";
import { readFileSync } from "node:fs";
const { PGlite } = await import("../supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite/dist/index.js");
const db = new PGlite();
const base = readFileSync(new URL("../supabase/baseline/0001_initial_schema.sql", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../supabase/migrations/20261004045936_google_data_oauth_token_storage.sql", import.meta.url), "utf8");
const scopeSql = readFileSync(new URL("../supabase/migrations/20261005055748_google_calendar_scope_boundary.sql", import.meta.url), "utf8");
const itemSql = readFileSync(new URL("../supabase/migrations/20261005055754_persist_calendar_item.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const connection = "33333333-3333-4333-8333-333333333333";
const old = "2026-10-01T00:00:00Z", newer = "2026-10-02T00:00:00Z";
const gmail = "https://www.googleapis.com/auth/gmail.readonly", drive = "https://www.googleapis.com/auth/drive.metadata.readonly";
const docs = "https://www.googleapis.com/auth/documents.readonly", calendar = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
const scopes = ["openid", "email", "profile", gmail, drive, docs, calendar];
const one = async (sql, args=[]) => (await db.query(sql,args)).rows[0];
const scalar = async (sql,args=[]) => Object.values(await one(sql,args))[0];
try {
  await db.exec("create role anon; create role authenticated; create role service_role; create table public.users(id uuid primary key);");
  for(const name of ["connection_provider","connection_status","item_source","item_format","processing_status"])
    await db.exec(base.match(new RegExp(`create type public\\.${name} as enum \\([\\s\\S]*?;`))[0]);
  for(const name of ["connections","items"])
    await db.exec(base.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?;`))[0]);
  for(const name of ["connections_user_provider_account_uidx","items_google_external_identity_uidx"])
    await db.exec(base.match(new RegExp(`create unique index ${name}[\\s\\S]*?;`))[0]);
  await db.exec(tokens.slice(tokens.indexOf("create schema if not exists private;"),tokens.indexOf("create or replace function public.upsert_google_connection")));
  await db.exec(base.match(/create or replace function public\.set_updated_at\(\)[\s\S]*?\$\$;/)[0]);
  for(const name of ["connections","items"])
    await db.exec(base.match(new RegExp(`create trigger ${name}_set_updated_at[\\s\\S]*?;`))[0]);
  // Only preservation sentinels; this does not reproduce production ancillary-table RLS.
  await db.exec("create table public.classifications(item_id uuid,user_tags text[]); create table public.actions(id int,status text); create table public.action_sources(id int,evidence text);");
  await db.exec(readFileSync("supabase/migrations/20261004145244_google_drive_oauth_scope_boundary.sql","utf8"));await db.exec(scopeSql); await db.exec(itemSql);await db.exec(readFileSync("supabase/migrations/20261005013202_persist_drive_item.sql","utf8"));
  await applyConflictMigration(db,["persist_drive_item","upgrade_google_connection_scopes"]);
  await db.query("insert into public.users values ($1),($2)",[owner,other]);
  await db.query("insert into public.connections(id,user_id,provider_account_id,account_email,status,scopes,sync_state,connected_at,last_synced_at,updated_at) values($1,$2,'synthetic-sub','fixture@example.invalid','connected',$3,$4::jsonb,$5,$5,$5)",
    [connection,owner,scopes,JSON.stringify({gmail:{history_id:"123",initial_collection:{complete:true}},drive:{preserve:true}}),old]);
  await db.query("insert into private.google_connection_tokens(connection_id,user_id,access_token_ciphertext,access_token_iv,access_token_tag,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag,token_expires_at) values($1,$2,'synthetic-old','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour')",[connection,owner]);
  const {createHash}=await import('node:crypto');const hash=text=>createHash('sha256').update(text).digest('hex');
  const drivePersist=async(file='file1',text='Original',date=old,stamp=null)=>scalar('select public.persist_drive_item($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::jsonb,$11::timestamptz)',[owner,connection,file,'Synthetic','https://docs.google.com/document/d/'+file+'/edit',text,hash(text),old,date,'{}',stamp]);
  const first=await drivePersist();assert.equal(first.outcome,'created');assert.equal((await drivePersist()).outcome,'reused');
  const row=await one('select *,updated_at::text snapshot from public.items where id=$1',[first.item_id]);
  for(const [file,text,date,stamp,message] of [['file1','New',old,row.snapshot,'Same source version has conflicting content'],['file1','New','2026-09-01T00:00:00Z',row.snapshot,'Stale source snapshot'],['file1','New',newer,old,'ITEM changed during collection'],['missing','New',newer,row.snapshot,'Expected ITEM missing']]){
    let attempts=0;await assert.rejects(()=>{attempts++;return drivePersist(file,text,date,stamp);},e=>e.code==='PT409'&&e.message===message);assert.equal(attempts,1);
  }
  assert.deepEqual(await one('select *,updated_at::text snapshot from public.items where id=$1',[first.item_id]),row);
  assert.equal((await drivePersist('file1','New',newer,row.snapshot)).outcome,'updated');
  console.log('PASS: Drive create/reuse/update and all four stale/conflict branches reject once; rejected data preserved.');
  const upgrade=(changes={})=>{const args={user:owner,connection,account:'synthetic-sub',email:'fixture@example.invalid',scopes,snapshot:old,cipher:'synthetic-old',access:'new-access',iv:'iv',tag:'tag',refresh:'new-refresh',riv:'iv',rtag:'tag',expires:new Date(Date.now()+3600000).toISOString(),version:1,...changes};return scalar('select public.upgrade_google_connection_scopes($1::uuid,$2::uuid,$3,$4,$5::text[],$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::smallint)',Object.values(args));};
  const before=await one('select to_jsonb(c) c,(select to_jsonb(t) from private.google_connection_tokens t where connection_id=c.id) t from public.connections c where id=$1',[connection]);
  for(const changes of [{account:'foreign'},{snapshot:newer},{cipher:'stale'}])await assert.rejects(()=>upgrade(changes),e=>e.code==='PT409');
  assert.deepEqual(await one('select to_jsonb(c) c,(select to_jsonb(t) from private.google_connection_tokens t where connection_id=c.id) t from public.connections c where id=$1',[connection]),before);
  assert.equal(await upgrade(),connection);
  const after=await one('select * from public.connections where id=$1',[connection]);assert.deepEqual(after.sync_state,before.c.sync_state);for(const key of ['last_synced_at','connected_at'])assert.equal(new Date(after[key]).getTime(),new Date(before.c[key]).getTime());
  console.log('PASS: Drive scopes normal upgrade and stale connection/token CAS; checkpoint and token atomicity preserved.');
}catch(error){console.error('FAIL: offline Drive conflict SQL '+(error.code??error.name));process.exitCode=1;}finally{await db.close();}
