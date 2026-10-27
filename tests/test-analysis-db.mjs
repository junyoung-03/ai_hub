// Explicit development DB assertions. All synthetic rows (and optional draft DDL) roll back.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { content, fixture } from "./helpers/analysis-fixtures.mjs";
import { loadAnalysisModule } from "./helpers/analysis-loader.mjs";
const project = process.env.ANALYSIS_TEST_PROJECT;
if (project !== "oclzdppdiljbojvqtkeu") { console.error("NOT RUN: explicit development target required."); process.exit(2); }
const validation = loadAnalysisModule("src/lib/gemini/validation.ts");
const result = validation.validateAnalysis(fixture(), content);
const json = JSON.stringify(result);
// Fixed synthetic input, not remote email. Dollar quote delimiters are absent from fixtures.
const tests = `
do $test$
declare
  u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  i uuid:=gen_random_uuid(); rollback_i uuid:=gen_random_uuid();
  a jsonb:=$json$${json}$json$::jsonb; changed jsonb; bad jsonb; r jsonb;
  body text:=$body$${content}$body$; saved_metadata jsonb;
  action_count bigint; source_count bigint; fn text:='public.persist_gmail_item_analysis(uuid,uuid,text,text,jsonb,text,text)';
begin
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')
    or not has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'Privilege assertion failed'; end if;
  insert into auth.users(id,email,raw_user_meta_data) values(u,'phase6a-'||u||'@example.invalid','{}'),(other_u,'phase6a-'||other_u||'@example.invalid','{}');
  if not exists(select 1 from public.users where id=u) then raise exception 'User trigger assertion failed'; end if;
  insert into public.connections(id,user_id,provider,status,provider_account_id) values(c,u,'google','connected','phase6a-fixture');
  insert into public.items(id,user_id,connection_id,source,format,external_id,content_text,processing_status,metadata)
    values(i,u,c,'gmail','email','phase6a-item',body,'queued','{"threadId":"synthetic-thread"}'),
    (rollback_i,u,c,'gmail','email','phase6a-rollback',body,'queued','{}');
  execute 'set local role service_role';
  r:=public.persist_gmail_item_analysis(u,i,body,null,a,'gemini-fixture',repeat('a',64));
  if r->>'created_count'<>'1' then raise exception 'Creation assertion failed'; end if;
  execute 'reset role';
  execute 'set constraints all immediate';
  if not exists(select 1 from public.actions x join public.action_sources s on s.id=x.deadline_source_id
    where x.user_id=u and x.deadline_status='confirmed' and x.deadline_date='2026-10-15'
      and s.item_id=i and s.is_current and s.observed_deadline_date=x.deadline_date) then raise exception 'Deadline assertion failed'; end if;
  if (select metadata#>>'{aiAnalysis,result,eventObservations,0,date}' from public.items where id=i)<>'2026-10-20'
    or (select metadata#>>'{aiAnalysis,schemaVersion}' from public.items where id=i)<>'0.2'
    or (select metadata->>'threadId' from public.items where id=i)<>'synthetic-thread' then raise exception 'Event/metadata assertion failed'; end if;
  execute 'set constraints all deferred';
  select count(*) into action_count from public.actions where user_id=u;
  select count(*) into source_count from public.action_sources where user_id=u;
  select metadata into saved_metadata from public.items where id=i;
  r:=public.persist_gmail_item_analysis(u,i,body,null,a,'gemini-fixture',repeat('a',64));
  if r->>'cached'<>'true' or (select count(*) from public.actions where user_id=u)<>action_count
    or (select count(*) from public.action_sources where user_id=u)<>source_count
    or (select metadata from public.items where id=i)<>saved_metadata then raise exception 'Idempotency assertion failed'; end if;
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  perform public.set_classification_override(i,'User topic','general','{}'::text[]);
  execute 'reset role';
  changed:=jsonb_set(a,'{classification,primaryTopic}','"New AI topic"');
  perform public.persist_gmail_item_analysis(u,i,body,null,changed,'gemini-fixture',repeat('a',64));
  if not exists(select 1 from public.classifications where item_id=i and user_primary_topic='User topic'
    and user_document_type='general' and user_tags='{}'::text[] and ai_primary_topic='New AI topic')
    or (select count(*) from public.action_sources where user_id=u)<>source_count then raise exception 'Override assertion failed'; end if;
  begin
    perform public.persist_gmail_item_analysis(other_u,i,body,null,a,'gemini-fixture',repeat('a',64));
    raise exception 'Cross-user request unexpectedly succeeded';
  exception when no_data_found then null; end;
  begin
    perform public.persist_gmail_item_analysis(u,i,body||'changed',null,a,'gemini-fixture',repeat('a',64));
    raise exception 'Stale input unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  -- Force failure after Classification, first Action and first Source have been inserted.
  bad:=jsonb_set(a,'{actions}',(a->'actions') || jsonb_build_array(
    jsonb_set(jsonb_set(a#>'{actions,0}','{title}','"Different fixture"'),'{actionType}','"invalid"')));
  begin
    perform public.persist_gmail_item_analysis(u,rollback_i,body,null,bad,'gemini-fixture',repeat('b',64));
    raise exception 'Invalid second Action unexpectedly succeeded';
  exception when invalid_text_representation then null; end;
  if exists(select 1 from public.classifications where item_id=rollback_i)
    or exists(select 1 from public.action_sources where item_id=rollback_i)
    or (select count(*) from public.actions where user_id=u)<>action_count
    or (select metadata ? 'aiAnalysis' from public.items where id=rollback_i)
    or (select processing_status from public.items where id=rollback_i)<>'queued' then raise exception 'Full rollback assertion failed'; end if;
  -- Event-only item creates no Action at all.
  changed:=jsonb_set(a,'{actions}','[]');
  perform public.persist_gmail_item_analysis(u,rollback_i,body,null,changed,'gemini-fixture',repeat('b',64));
  if exists(select 1 from public.action_sources where item_id=rollback_i)
    or (select count(*) from public.actions where user_id=u)<>action_count then raise exception 'No-action assertion failed'; end if;
  execute 'set constraints all immediate';
end;
$test$;
select true as phase6a_runtime_assertions_pass;
`;
const draft = process.argv.includes("--with-draft") ? readFileSync("supabase/migrations/20261004115419_persist_gmail_item_analysis.sql","utf8")
  .replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,"") : "";
mkdirSync("supabase/.temp",{recursive:true});
const file="supabase/.temp/phase6a-runtime.sql";
writeFileSync(file,"begin;\n"+draft+tests+"\nrollback;\n");
try {
  const child=spawnSync(process.platform==="win32"?"cmd.exe":"npx",process.platform==="win32"
    ?["/d","/s","/c",`npx --yes supabase@latest db query --linked --project-ref ${project} --file ${file}`]
    :["--yes","supabase@latest","db","query","--linked","--project-ref",project,"--file",file],{encoding:"utf8",timeout:60000});
  if(child.status!==0){
    const code=(child.stdout+child.stderr).match(/"code"\s*:\s*"([A-Za-z0-9_]+)"/);
    // Only SQL state/code and our synthetic assertion messages are safe diagnostic fields.
    const assertion=(child.stdout+child.stderr).match(/(?:[A-Z][A-Za-z /-]*assertion failed|Invalid [A-Za-z ]+|syntax error at or near [^\n"]+)/);
    console.error("FAIL: development runtime assertions; "+(code?.[1]??"query-error")+" "+(assertion?.[0]??"details suppressed"));
    process.exitCode=1;
  } else console.log("PASS: DB privileges, atomic Action/Evidence, v0.2 events, idempotency, override, cross-user, stale input, full rollback, no-action. Cleanup: rolled back.");
} finally { unlinkSync(file); }
