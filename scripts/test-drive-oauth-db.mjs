import {conflictBlocks} from './rpc-conflicts-migration.mjs';
// Explicit development-only RPC assertions. Synthetic users/tokens and draft DDL roll back.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const project = process.env.DRIVE_OAUTH_TEST_PROJECT;
if (project !== "oclzdppdiljbojvqtkeu") {
  console.error("NOT RUN: explicit development target required."); process.exit(2);
}
const sql = `
do $test$
declare
  u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); c uuid; saved public.connections%rowtype;
  gmail text[]:=array['openid','email','profile','https://www.googleapis.com/auth/gmail.readonly'];
  drive_scopes text[]; rejected text[]; fn record; after_token text; before_token text;
begin
  drive_scopes:=gmail||array['https://www.googleapis.com/auth/drive.metadata.readonly','https://www.googleapis.com/auth/documents.readonly'];
  for fn in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('upsert_google_connection','upgrade_google_connection_scopes','refresh_google_connection_tokens_guarded') loop
    if not fn.prosecdef or not ('search_path=""'=any(fn.proconfig))
      or has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE')
      or not has_function_privilege('service_role',fn.oid,'EXECUTE') then raise exception 'Privilege assertion failed'; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('upsert_google_connection','upgrade_google_connection_scopes','refresh_google_connection_tokens_guarded'))<>3
    then raise exception 'Function count assertion failed'; end if;
  insert into auth.users(id,email,raw_user_meta_data) values
    (u,'drive3-'||u||'@example.invalid','{}'),(other_u,'drive3-'||other_u||'@example.invalid','{}');
  execute 'set local role service_role';
  c:=public.upsert_google_connection(u,'drive3-synthetic','drive3@example.invalid',gmail,'123',
    'access-old','iv','tag','refresh-old','iv','tag',now()+interval '1 hour',1::smallint);
  execute 'reset role';
  update public.connections set sync_state='{"gmail":{"history_id":"123","initial_collection":{"complete":true}},"other":{"keep":true}}',
    last_synced_at='2026-09-01T00:00:00Z', connected_at='2026-08-01T00:00:00Z' where id=c;
  select * into saved from public.connections where id=c;
  select md5(row_to_json(t)::text) into before_token from private.google_connection_tokens t where connection_id=c;
  execute 'set local role service_role';
  -- Reject missing Gmail, partial Drive grant and an unapproved scope atomically.
  foreach rejected slice 1 in array array[
    array['https://www.googleapis.com/auth/drive.metadata.readonly','https://www.googleapis.com/auth/documents.readonly'],
    array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/documents.readonly'],
    array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/drive']] loop
    begin
      perform public.upgrade_google_connection_scopes(u,c,'drive3-synthetic','drive3@example.invalid',rejected,saved.updated_at,'access-old',
        'bad-access','iv','tag','bad-refresh','iv','tag',now()+interval '1 hour',1::smallint);
      raise exception 'Invalid scope unexpectedly accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.upgrade_google_connection_scopes(other_u,c,'drive3-synthetic','drive3@example.invalid',drive_scopes,saved.updated_at,'access-old',
      'bad-access','iv','tag','bad-refresh','iv','tag',now()+interval '1 hour',1::smallint);
    raise exception 'Foreign user unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.upgrade_google_connection_scopes(u,c,'different-account','drive3@example.invalid',drive_scopes,saved.updated_at,'access-old',
      'bad-access','iv','tag','bad-refresh','iv','tag',now()+interval '1 hour',1::smallint);
    raise exception 'Different account unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.upgrade_google_connection_scopes(u,c,'drive3-synthetic','drive3@example.invalid',drive_scopes,saved.updated_at-interval '1 second','access-old',
      'bad-access','iv','tag','bad-refresh','iv','tag',now()+interval '1 hour',1::smallint);
    raise exception 'Stale connection unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.upgrade_google_connection_scopes(u,c,'drive3-synthetic','drive3@example.invalid',drive_scopes,saved.updated_at,'stale-access',
      'bad-access','iv','tag','bad-refresh','iv','tag',now()+interval '1 hour',1::smallint);
    raise exception 'Stale token unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  execute 'reset role';
  select md5(row_to_json(t)::text) into after_token from private.google_connection_tokens t where connection_id=c;
  if after_token is distinct from before_token or (select row_to_json(x)::jsonb from public.connections x where id=c)
    is distinct from row_to_json(saved)::jsonb then raise exception 'Failure preservation assertion failed'; end if;
  execute 'set local role service_role';
  if public.upgrade_google_connection_scopes(u,c,'drive3-synthetic','drive3@example.invalid',drive_scopes,saved.updated_at,'access-old',
    'access-upgraded','iv','tag','refresh-upgraded','iv','tag',now()+interval '1 hour',1::smallint)<>c
    then raise exception 'Identity assertion failed'; end if;
  execute 'reset role';
  if not exists(select 1 from public.connections where id=c and scopes=drive_scopes
    and sync_state=saved.sync_state and last_synced_at=saved.last_synced_at and connected_at=saved.connected_at)
    then raise exception 'Gmail checkpoint assertion failed'; end if;
  execute 'set local role service_role';
  begin
    perform public.upsert_google_connection(u,'drive3-synthetic','drive3@example.invalid',gmail,'999',
      'bad-access','iv','tag',null,null,null,now()+interval '1 hour',1::smallint);
    raise exception 'Scope downgrade unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  if public.refresh_google_connection_tokens_guarded(u,c,'bad-access','iv','tag',null,null,null,now()+interval '1 hour',1::smallint,'access-old')
    or public.refresh_google_connection_tokens_guarded(other_u,c,'bad-access','iv','tag',null,null,null,now()+interval '1 hour',1::smallint,'access-upgraded')
    then raise exception 'Stale refresh assertion failed'; end if;
  if not public.refresh_google_connection_tokens_guarded(u,c,'access-refreshed','iv','tag',null,null,null,now()+interval '1 hour',1::smallint,'access-upgraded')
    then raise exception 'Guarded refresh assertion failed'; end if;
  execute 'reset role';
  if not exists(select 1 from private.google_connection_tokens where connection_id=c and access_token_ciphertext='access-refreshed'
    and refresh_token_ciphertext='refresh-upgraded') then raise exception 'Refresh preservation assertion failed'; end if;
  if not exists(select 1 from public.connections where id=c and sync_state=saved.sync_state and scopes @> gmail)
    then raise exception 'Refresh checkpoint assertion failed'; end if;
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  if not public.disconnect_google_connection(c) then raise exception 'Disconnect assertion failed'; end if;
  execute 'reset role';
  execute 'set local role service_role';
  if public.refresh_google_connection_tokens_guarded(u,c,'bad-access','iv','tag',null,null,null,now()+interval '1 hour',1::smallint,'access-refreshed')
    then raise exception 'Disconnected refresh assertion failed'; end if;
  begin
    perform public.upgrade_google_connection_scopes(u,c,'drive3-synthetic','drive3@example.invalid',drive_scopes,saved.updated_at,'access-refreshed',
      'bad-access','iv','tag','bad-refresh','iv','tag',now()+interval '1 hour',1::smallint);
    raise exception 'Disconnected upgrade unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  execute 'reset role';
  if exists(select 1 from private.google_connection_tokens where connection_id=c)
    or not exists(select 1 from public.connections where id=c and status='disconnected' and sync_state=saved.sync_state)
    then raise exception 'Disconnect barrier assertion failed'; end if;
end;
$test$;
select true as drive3_runtime_assertions_pass;
`;
const draft = process.argv.includes("--with-draft")
  ? readFileSync("supabase/migrations/20261004145244_google_drive_oauth_scope_boundary.sql", "utf8")
    .replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "") : "";
mkdirSync("supabase/.temp", { recursive: true });
const file = "supabase/.temp/drive3-runtime.sql";
writeFileSync(file, "begin;set local lock_timeout='5s';\n" + draft + (process.argv.includes("--with-conflict-migration")?conflictBlocks():"") + sql + "\nrollback;\n");
try {
  const child = spawnSync(process.platform === "win32" ? "cmd.exe" : "npx", process.platform === "win32"
    ? ["/d", "/s", "/c", `npx --yes supabase db query --linked --project-ref ${project} --file ${file}`]
    : ["--yes", "supabase", "db", "query", "--linked", "--project-ref", project, "--file", file],
    { encoding: "utf8", timeout: 60000 });
  const output = (child.stdout ?? "") + (child.stderr ?? "");
  if (child.status !== 0 || !output.includes('"drive3_runtime_assertions_pass": true')) {
    const code = output.match(/"code"\s*:\s*"([A-Za-z0-9_]+)"/);
    const assertion = output.match(/[A-Z][A-Za-z /-]*assertion failed/);
    console.error(`FAIL: Drive OAuth DB assertions; ${code?.[1] ?? "query-error"} ${assertion?.[0] ?? "details suppressed"}`);
    process.exitCode = 1;
  } else console.log("PASS: service-only privileges, grants, owner/account, stale CAS, atomic rejection, Gmail checkpoint, downgrade protection, guarded refresh, disconnect barrier. Synthetic rows and draft DDL rolled back.");
} finally { unlinkSync(file); }
