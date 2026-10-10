// Offline PostgreSQL/WASM rehearsal. Never reads .env, connects to Supabase, or persists a database.
// The engine is a temporary test tool, deliberately absent from product dependencies.
import assert from "node:assert/strict";
import {applyConflictMigration} from "./rpc-conflicts-migration.mjs";
import { readFileSync } from "node:fs";
import { load } from "./calendar-loader.mjs";
const { PGlite } = await import("../supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite/dist/index.js");
const db = new PGlite();
const contract = load("src/lib/google/calendar-contract.ts");
const base = readFileSync(new URL("../supabase/baseline/0001_initial_schema.sql", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../supabase/migrations/20261004045936_google_data_oauth_token_storage.sql", import.meta.url), "utf8");
const scopeSql = readFileSync(new URL("../supabase/migrations/20261005055748_google_calendar_scope_boundary.sql", import.meta.url), "utf8");
const itemSql = readFileSync(new URL("../supabase/migrations/20261005055754_persist_calendar_item.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const connection = "33333333-3333-4333-8333-333333333333";
const old = "2026-10-01T00:00:00Z", newer = "2026-10-02T00:00:00Z", latest = "2026-10-03T00:00:00Z";
const gmail = "https://www.googleapis.com/auth/gmail.readonly", drive = "https://www.googleapis.com/auth/drive.metadata.readonly";
const docs = "https://www.googleapis.com/auth/documents.readonly", calendar = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
const scopes = ["openid", "email", "profile", gmail, drive, docs, calendar];
const one = async (sql, args=[]) => (await db.query(sql,args)).rows[0];
const scalar = async (sql,args=[]) => Object.values(await one(sql,args))[0];
function event(changes={}) {
  return contract.parseEvent({ id:"event1", etag:'"v1"', status:"confirmed", eventType:"default", summary:"Synthetic",
    description:"Synthetic text", location:"Room", created:old, updated:old,
    start:{dateTime:"2026-10-05T09:00:00+09:00",timeZone:"Asia/Seoul"},
    end:{dateTime:"2026-10-05T10:00:00+09:00",timeZone:"Asia/Seoul"}, ...changes }, "Asia/Seoul", text=>text);
}
async function persist(e, snapshot=null, user=owner, overrides={}) {
  const c=contract.canonicalEvent(e);
  const args={ user, connection, event:e.eventId, title:e.summary, url:e.htmlLink, text:c.text, hash:c.hash,
    created:e.created, updated:e.updated, meta:JSON.stringify(e), snapshot, ...overrides };
  return scalar("select public.persist_calendar_item($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::jsonb,$11::timestamptz)", Object.values(args));
}
const item=async()=>one("select *,updated_at::text as snapshot from public.items where external_id='event1'");
async function rejected(fn, code="PT409") {
  let didReject=false;
  try { await fn(); } catch(error) { assert.equal(error.code,code); didReject=true; }
  assert.ok(didReject,"Expected SQL rejection");
}
let checks=0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS: ${name}`); }
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
  await db.exec(scopeSql); await db.exec(itemSql);
  await applyConflictMigration(db,["persist_calendar_item","upgrade_google_calendar_scopes"]);
  await db.query("insert into public.users values ($1),($2)",[owner,other]);
  await db.query("insert into public.connections(id,user_id,provider_account_id,account_email,status,scopes,sync_state,connected_at,last_synced_at,updated_at) values($1,$2,'synthetic-sub','fixture@example.invalid','connected',$3,$4::jsonb,$5,$5,$5)",
    [connection,owner,scopes,JSON.stringify({gmail:{history_id:"123",initial_collection:{complete:true}},drive:{preserve:true}}),old]);
  await db.query("insert into private.google_connection_tokens(connection_id,user_id,access_token_ciphertext,access_token_iv,access_token_tag,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag,token_expires_at) values($1,$2,'synthetic-old','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour')",[connection,owner]);
  await check("new event has Calendar identity, queued status, null storage/mime and exact source dates",async()=>{
    const r=await persist(event()); assert.equal(r.outcome,"created"); const row=await item();
    assert.equal(row.source,"calendar"); assert.equal(row.format,"calendar_event"); assert.equal(row.external_container_id,"primary");
    assert.equal(row.processing_status,"queued"); assert.equal(row.storage_path,null); assert.equal(row.mime_type,null);
    assert.equal(new Date(row.source_updated_at).toISOString(),new Date(old).toISOString());
  });
  await db.query("insert into public.classifications values($1,array['user override'])",[(await item()).id]);
  await db.exec("insert into public.actions values(1,'completed'); insert into public.action_sources values(1,'preserve');");
  await db.exec("update public.items set metadata=metadata||'{\"aiAnalysis\":{\"preserve\":true}}'::jsonb");
  const graph=async()=>JSON.stringify(await one("select (select jsonb_agg(t) from public.classifications t) c,(select jsonb_agg(t) from public.actions t) a,(select jsonb_agg(t) from public.action_sources t) e"));
  const beforeGraph=await graph(); let snapshot=(await item()).snapshot;
  await check("same event reuses without DB UPDATE or duplicate ITEM",async()=>{
    assert.equal((await persist(event(),snapshot)).outcome,"reused"); assert.equal((await item()).snapshot,snapshot);
    assert.equal(await scalar("select count(*)::int from public.items"),1);
  });
  await check("update and time move keep ITEM ID, user override, Action/Evidence and AI metadata",async()=>{
    const before=await item(); const e=event({updated:newer,etag:'"v2"',start:{dateTime:"2026-10-06T09:00:00+09:00"},end:{dateTime:"2026-10-06T10:00:00+09:00"}});
    assert.equal((await persist(e,before.snapshot)).outcome,"updated"); const after=await item();
    assert.equal(after.id,before.id); assert.equal(after.metadata.calendar.start.dateTime,e.start.dateTime);
    assert.equal(after.metadata.aiAnalysis.preserve,true); assert.equal(await graph(),beforeGraph);
  });
  await check("stale/equal version, stale ITEM CAS and content hash tampering reject atomically",async()=>{
    const before=await item(); await rejected(()=>persist(event(),before.snapshot));
    await rejected(()=>persist(event({updated:latest}),snapshot));
    await rejected(()=>persist(event({updated:newer,etag:'"conflict"'}),before.snapshot));
    await rejected(()=>persist(event({updated:latest}),before.snapshot,owner,{hash:"0".repeat(64)}),"22023");
    assert.deepEqual(await item(),before);
  });
  await check("known cancellation preserves normal body, dates, URL, analysis and related graph",async()=>{
    const before=await item(); const e=event({status:"cancelled",updated:latest,etag:'"v3"',start:undefined,end:undefined,summary:undefined,description:undefined,location:undefined});
    assert.equal((await persist(e,before.snapshot)).outcome,"updated"); const after=await item();
    assert.equal(after.content_text,before.content_text); assert.deepEqual(after.metadata.calendar.start,before.metadata.calendar.start);
    assert.equal(after.metadata.calendar.status,"cancelled"); assert.equal(await graph(),beforeGraph);
    assert.equal((await persist(e,after.snapshot)).outcome,"reused");
    await rejected(()=>persist(event({status:"cancelled",updated:undefined}),after.snapshot));
    await rejected(()=>persist(event({updated:newer}),after.snapshot));
  });
  await check("unseen cancellation creates no ITEM; null source dates and all-day/recurring dates stay unguessed",async()=>{
    assert.equal((await persist(event({id:"unseen",status:"cancelled",updated:undefined,start:undefined,end:undefined}))).outcome,"skipped");
    const e=event({id:"allday",created:undefined,updated:undefined,start:{date:"2026-10-05"},end:{date:"2026-10-07"},recurringEventId:"master",originalStartTime:{date:"2026-10-05"}});
    assert.equal((await persist(e)).outcome,"created");
    const row=await one("select * from public.items where external_id='allday'");
    assert.equal(row.source_created_at,null); assert.equal(row.source_updated_at,null);
    assert.equal(row.metadata.calendar.start.date,"2026-10-05"); assert.equal(row.metadata.calendar.end.date,"2026-10-07");
    assert.equal(row.metadata.calendar.recurringEventId,"master");
  });
  await check("other owner, missing Scope/token and disconnect cannot persist",async()=>{
    const before=await item(); await rejected(()=>persist(event(),before.snapshot,other),"22023");
    await db.query("update public.connections set scopes=$1 where id=$2",[[gmail,drive,docs],connection]);
    await rejected(()=>persist(event(),before.snapshot),"22023");
    await db.query("update public.connections set scopes=$1,status='disconnected' where id=$2",[scopes,connection]);
    await rejected(()=>persist(event(),before.snapshot),"22023");
    await db.exec("update public.connections set status='connected'");
    await db.exec("begin; delete from private.google_connection_tokens;");
    await rejected(()=>persist(event(),before.snapshot),"22023"); await db.exec("rollback;");
    assert.deepEqual(await item(),before);
  });
  const upgrade=async(granted=scopes,changes={})=>{
    const row=await one("select *,updated_at::text as snapshot from public.connections where id=$1",[connection]);
    const args={user:owner,conn:connection,account:"synthetic-sub",email:"fixture@example.invalid",granted,
      snapshot:row.snapshot,cipher:"synthetic-old",access:"synthetic-new",iv:"iv",tag:"tag",refresh:"synthetic-refresh",riv:"iv",rtag:"tag",
      expires:new Date(Date.now()+3600000).toISOString(),version:1,...changes};
    return scalar("select public.upgrade_google_calendar_scopes($1::uuid,$2::uuid,$3,$4,$5::text[],$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::smallint)",Object.values(args));
  };
  await check("Scope RPC rejects partial grants, foreign identity and stale token/connection atomically",async()=>{
    const before=await scalar("select to_jsonb(c) from public.connections c where id=$1",[connection]);
    for(const removed of [calendar,gmail,drive,docs]) await rejected(()=>upgrade(scopes.filter(s=>s!==removed)),"22023");
    await rejected(()=>upgrade(scopes,{account:"other-sub"})); await rejected(()=>upgrade(scopes,{cipher:"stale"}));
    await rejected(()=>upgrade(scopes,{snapshot:old}));
    assert.deepEqual(await scalar("select to_jsonb(c) from public.connections c where id=$1",[connection]),before);
  });
  await check("Scope upgrade preserves entire Gmail/Drive checkpoint, connection timestamps and refresh token",async()=>{
    const before=await one("select * from public.connections where id=$1",[connection]);
    assert.equal(await upgrade(),connection); const after=await one("select * from public.connections where id=$1",[connection]);
    for(const key of ["sync_state","last_synced_at","connected_at"]) assert.deepEqual(after[key],before[key]);
    assert.deepEqual(after.scopes,scopes);
    const bundle=await one("select * from private.google_connection_tokens");
    assert.equal(bundle.refresh_token_ciphertext,"synthetic-refresh"); assert.equal(bundle.access_token_ciphertext,"synthetic-new");
  });
  await check("function execution is service_role-only with SECURITY DEFINER and empty search_path",async()=>{
    for(const name of ["persist_calendar_item","upgrade_google_calendar_scopes"]){
      const permissions=await one("select p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname=$1",[name]);
      assert.equal(permissions.prosecdef,true); assert.equal(permissions.a,false); assert.equal(permissions.u,false); assert.equal(permissions.s,true);
      assert.ok(permissions.proconfig.includes('search_path=""'));
    }
  });
  console.log(`PASS: ${checks} offline SQL checks; no remote DB, Google, credentials or persisted database.`);
} catch(error) {
  console.error(`FAIL: offline Calendar SQL rehearsal (${error.code ?? error.name}). No query/parameter output.`);
  process.exitCode=1;
} finally { await db.close(); }
