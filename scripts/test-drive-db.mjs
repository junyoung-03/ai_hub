import {conflictBlocks} from './rpc-conflicts-migration.mjs';
// Development-only synthetic RPC/RLS checks. Every fixture and optional DDL rolls back.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const project = process.env.DRIVE_DB_TEST_PROJECT;
if (project !== "oclzdppdiljbojvqtkeu") { console.error("NOT RUN: explicit dev target required."); process.exit(2); }
const tests = `
do $test$
declare
  u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); c uuid; i uuid; a uuid:=gen_random_uuid();
  body text:='Synthetic 😀 original'; changed text:='Synthetic 😀 updated'; h text; changed_h text; r jsonb; stamp timestamptz;
  classification_snapshot jsonb; action_snapshot jsonb; source_snapshot jsonb; item_snapshot jsonb;
  fn text:='public.persist_drive_item(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,jsonb,timestamptz)';
begin
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')
    or not has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'Privilege assertion failed'; end if;
  h:=encode(sha256(convert_to(body,'UTF8')),'hex'); changed_h:=encode(sha256(convert_to(changed,'UTF8')),'hex');
  insert into auth.users(id,email,raw_user_meta_data) values(u,'drive-item-'||u||'@example.invalid','{}'),(other_u,'drive-item-'||other_u||'@example.invalid','{}');
  c:=public.upsert_google_connection(u,'drive-item-fixture','fixture@example.invalid',array[
    'https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/drive.metadata.readonly','https://www.googleapis.com/auth/documents.readonly'],
    '100','synthetic-access','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour',1::smallint);
  execute 'set local role service_role';
  r:=public.persist_drive_item(u,c,'file1','Synthetic','https://docs.google.com/document/d/file1/edit',body,h,
    '2026-09-01','2026-10-01','{"extractionVersion":"docs-text-v1"}',null);
  i:=(r->>'item_id')::uuid;
  if r->>'outcome'<>'created' then raise exception 'Creation assertion failed'; end if;
  r:=public.persist_drive_item(u,c,'file1','Synthetic','https://docs.google.com/document/d/file1/edit',body,h,
    '2026-09-01','2026-10-01','{}',null);
  if r->>'outcome'<>'reused' or r->>'item_id'<>i::text then raise exception 'Idempotency assertion failed'; end if;
  execute 'reset role';
  if not exists(select 1 from public.items where id=i and source='drive' and format='document' and external_id='file1'
    and external_container_id is null and storage_path is null and processing_status='queued') then raise exception 'Mapping assertion failed'; end if;
  insert into public.classifications(user_id,item_id,ai_primary_topic,user_primary_topic,user_document_type,user_tags)
    values(u,i,'AI fixture','User override','general','{}');
  insert into public.actions(id,user_id,title,action_type) values(a,u,'Synthetic action','check');
  insert into public.action_sources(user_id,action_id,item_id,evidence_text,evidence_locator) values(u,a,i,'Synthetic','{"start":0,"end":9}');
  update public.items set metadata=metadata||'{"custom":"keep","aiAnalysis":{"keep":true}}' where id=i;
  select updated_at,row_to_json(x)::jsonb into stamp,item_snapshot from public.items x where id=i;
  select row_to_json(x)::jsonb into classification_snapshot from public.classifications x where item_id=i;
  select row_to_json(x)::jsonb into action_snapshot from public.actions x where id=a;
  select row_to_json(x)::jsonb into source_snapshot from public.action_sources x where item_id=i;
  execute 'set local role service_role';
  begin
    perform public.persist_drive_item(other_u,c,'file1','Synthetic','https://docs.google.com/document/d/file1/edit',changed,changed_h,
      '2026-09-01','2026-10-02','{}',stamp);
    raise exception 'Foreign owner unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.persist_drive_item(u,c,'file1','Synthetic','https://docs.google.com/document/d/file1/edit',changed,h,
      '2026-09-01','2026-10-02','{}',stamp);
    raise exception 'Invalid hash unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.persist_drive_item(u,c,'file1','Synthetic','https://docs.google.com/document/d/file1/edit',changed,changed_h,
      '2026-09-01','2026-09-30','{}',stamp);
    raise exception 'Older source unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.persist_drive_item(u,c,'file1','Synthetic','https://docs.google.com/document/d/file1/edit',changed,changed_h,
      '2026-09-01','2026-10-01','{}',stamp);
    raise exception 'Conflicting same version unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.persist_drive_item(u,c,'file1','Synthetic','https://docs.google.com/document/d/file1/edit',changed,changed_h,
      '2026-09-01','2026-10-02','{}',stamp-interval '1 second');
    raise exception 'Stale ITEM unexpectedly accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.persist_drive_item(u,c,'huge','Synthetic','https://docs.google.com/document/d/huge/edit',repeat('a',100001),repeat('a',64),
      '2026-09-01','2026-10-01','{}',null);
    raise exception 'Oversized body unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  if (select row_to_json(x)::jsonb from public.items x where id=i)<>item_snapshot then raise exception 'Rejected input preservation assertion failed'; end if;
  -- Each nested exception block restores its synthetic authorization changes.
  begin
    update public.connections set scopes=array['https://www.googleapis.com/auth/gmail.readonly'] where id=c;
    perform public.persist_drive_item(u,c,'file2','Synthetic','https://docs.google.com/document/d/file2/edit',body,h,
      '2026-09-01','2026-10-01','{}',null);
    raise exception 'Missing Drive scopes unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  begin
    delete from private.google_connection_tokens where connection_id=c;
    perform public.persist_drive_item(u,c,'file2','Synthetic','https://docs.google.com/document/d/file2/edit',body,h,
      '2026-09-01','2026-10-01','{}',null);
    raise exception 'Missing token unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  execute 'set local role service_role';
  r:=public.persist_drive_item(u,c,'file1','Updated','https://docs.google.com/document/d/file1/edit',changed,changed_h,
    '2026-09-01','2026-10-02','{"parents":["moved-folder"]}',stamp);
  if r->>'outcome'<>'updated' or r->>'item_id'<>i::text then raise exception 'Update identity assertion failed'; end if;
  execute 'reset role';
  if (select count(*) from public.items where user_id=u and source='drive' and external_id='file1')<>1
    or not exists(select 1 from public.items where id=i and content_text=changed and metadata->>'custom'='keep' and metadata#>>'{aiAnalysis,keep}'='true')
    or (select row_to_json(x)::jsonb from public.classifications x where item_id=i)<>classification_snapshot
    or (select row_to_json(x)::jsonb from public.actions x where id=a)<>action_snapshot
    or (select row_to_json(x)::jsonb from public.action_sources x where item_id=i)<>source_snapshot then raise exception 'Analysis preservation assertion failed'; end if;
  perform set_config('request.jwt.claim.sub',other_u::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.items where id=i) or exists(select 1 from public.classifications where item_id=i)
    or exists(select 1 from public.action_sources where item_id=i) then raise exception 'Foreign RLS assertion failed'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  if not exists(select 1 from public.items where id=i) then raise exception 'Owner RLS assertion failed'; end if;
  perform public.disconnect_google_connection(c);
  execute 'reset role';
  execute 'set local role service_role';
  begin
    perform public.persist_drive_item(u,c,'file2','Synthetic','https://docs.google.com/document/d/file2/edit',body,h,
      '2026-09-01','2026-10-01','{}',null);
    raise exception 'Disconnected writer unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  if not exists(select 1 from public.items where id=i and content_text=changed) then raise exception 'Disconnect body preservation assertion failed'; end if;
  execute 'set constraints all immediate';
end;
$test$;
select true as drive_item_assertions_pass;
`;
const draft = process.argv.includes("--with-draft") ? readFileSync("tests/fixtures/sql/drive/persist_drive_item.sql", "utf8")
  .replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "") : "";
mkdirSync("supabase/.temp", { recursive: true });
const file = "supabase/.temp/drive-item-runtime.sql";
writeFileSync(file, "begin;set local lock_timeout='5s';\n" + draft + (process.argv.includes("--with-conflict-migration")?conflictBlocks():"") + tests + "\nrollback;\n");
try {
  const child = spawnSync("cmd.exe", ["/d", "/s", "/c", `npx --yes supabase db query --linked --project-ref ${project} --file ${file}`],
    { encoding: "utf8", timeout: 60000 });
  const output = (child.stdout ?? "") + (child.stderr ?? "");
  if (child.status !== 0 || !output.includes('"drive_item_assertions_pass": true')) {
    const code = output.match(/"code"\s*:\s*"([A-Za-z0-9_]+)"/);
    const assertion = output.match(/[A-Z][A-Za-z /-]*assertion failed/);
    console.error(`FAIL: Drive ITEM DB assertions; ${code?.[1] ?? "query-error"} ${assertion?.[0] ?? "details suppressed"}`);
    process.exitCode = 1;
  } else console.log("PASS: service-only privileges, create/reuse/update identity, hash, stale source/ITEM, size, atomic rejection, Classification/Action/Evidence/user override, RLS and disconnect preservation. All fixtures rolled back.");
} finally { unlinkSync(file); }
