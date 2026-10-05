// Real ai-hub-dev PostgreSQL/RPC/RLS checks; all synthetic fixtures roll back.
import assert from "node:assert/strict";
import { load } from "./calendar-loader.mjs";
import { query, quote, snapshotSql } from "./calendar-dev-db.mjs";
const contract=load("src/lib/google/calendar-contract.ts");
const old="2026-10-01T00:00:00Z", newer="2026-10-02T00:00:00Z", latest="2026-10-03T00:00:00Z";
const event=(changes={})=>contract.parseEvent({id:"event1",etag:'"v1"',status:"confirmed",eventType:"default",summary:"Synthetic",description:"Synthetic text",created:old,updated:old,
  start:{dateTime:"2026-10-05T09:00:00+09:00",timeZone:"Asia/Seoul"},end:{dateTime:"2026-10-05T10:00:00+09:00",timeZone:"Asia/Seoul"},...changes},"Asia/Seoul",s=>s);
const fixtures={normal:event(),changed:event({updated:newer,etag:'"v2"',summary:"Synthetic changed"}),cancel:event({status:"cancelled",updated:latest,etag:'"v3"',start:undefined,end:undefined}),
  unknown:event({id:"unknown",status:"cancelled",start:undefined,end:undefined,updated:undefined}),
  allday:event({id:"allday",created:undefined,updated:undefined,start:{date:"2026-10-05"},end:{date:"2026-10-07"},recurringEventId:"master",originalStartTime:{date:"2026-10-05"}})};
function call(name,{user="u",stamp="null",hash}={}) {
  const e=fixtures[name], content=contract.canonicalEvent(e), nullable=v=>v===null?"null":quote(v);
  return `public.persist_calendar_item(${user},c,${quote(e.eventId)},${quote(e.summary)},${nullable(e.htmlLink)},${quote(content.text)},${quote(hash??content.hash)},${nullable(e.created)}::timestamptz,${nullable(e.updated)}::timestamptz,${quote(JSON.stringify(e))}::jsonb,${stamp})`;
}
const reject=(expression,code,label)=>`begin perform ${expression}; raise exception 'C3_${label}'; exception when sqlstate '${code}' then null; end;`;
const sql=`begin;
do $test$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); c uuid; i uuid; a uuid:=gen_random_uuid(); r jsonb; stamp timestamptz;
  item_snapshot jsonb; class_snapshot jsonb; action_snapshot jsonb; evidence_snapshot jsonb; conn_snapshot jsonb; token_snapshot jsonb; fn record; removed text;
  granted text[]:=array['openid','email','profile','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/drive.metadata.readonly','https://www.googleapis.com/auth/documents.readonly','https://www.googleapis.com/auth/calendar.events.owned.readonly'];
begin
  for fn in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('persist_calendar_item','upgrade_google_calendar_scopes') loop
    if not fn.prosecdef or not ('search_path=""'=any(fn.proconfig)) or has_function_privilege('anon',fn.oid,'execute') or has_function_privilege('authenticated',fn.oid,'execute') or not has_function_privilege('service_role',fn.oid,'execute') then raise exception 'C3_PRIVILEGES'; end if;
  end loop;
  insert into auth.users(id,email,raw_user_meta_data) values(u,'calendar3-'||u||'@example.invalid','{}'),(other_u,'calendar3-'||other_u||'@example.invalid','{}');
  execute 'set local role service_role';
  c:=public.upsert_google_connection(u,'calendar3-fixture','fixture@example.invalid',granted,'123','synthetic-access','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour',1::smallint);
  r:=${call('normal')}; i:=(r->>'item_id')::uuid;
  if r->>'outcome'<>'created' then raise exception 'C3_CREATE'; end if;
  execute 'reset role';
  if not exists(select 1 from public.items where id=i and source='calendar' and format='calendar_event' and external_container_id='primary' and processing_status='queued' and storage_path is null and mime_type is null) then raise exception 'C3_MAPPING'; end if;
  if exists(select 1 from public.classifications where item_id=i) or exists(select 1 from public.action_sources where item_id=i) then raise exception 'C3_NO_ANALYSIS'; end if;
  select to_jsonb(t),updated_at into item_snapshot,stamp from public.items t where id=i;
  execute 'set local role service_role'; r:=${call('normal',{stamp:'stamp'})}; execute 'reset role';
  if r->>'outcome'<>'reused' or r->>'item_id'<>i::text or (select to_jsonb(t) from public.items t where id=i)<>item_snapshot then raise exception 'C3_REUSE'; end if;
  insert into public.classifications(user_id,item_id,ai_primary_topic,user_primary_topic,user_document_type,user_tags) values(u,i,'AI fixture','User override','general','{}');
  insert into public.actions(id,user_id,title,action_type) values(a,u,'Synthetic action','check');
  insert into public.action_sources(user_id,action_id,item_id,evidence_text,evidence_locator) values(u,a,i,'Synthetic','{"start":0,"end":9}');
  update public.items set metadata=metadata||'{"aiAnalysis":{"keep":true},"custom":"keep"}' where id=i;
  select to_jsonb(t),updated_at into item_snapshot,stamp from public.items t where id=i;
  select to_jsonb(t) into class_snapshot from public.classifications t where item_id=i;
  select to_jsonb(t) into action_snapshot from public.actions t where id=a;
  select to_jsonb(t) into evidence_snapshot from public.action_sources t where item_id=i;
  execute 'set local role service_role';
  ${reject(call('changed',{user:'other_u',stamp:'stamp'}),'22023','FOREIGN')}
  ${reject(call('changed',{stamp:"stamp-interval '1 second'"}),'40001','STALE_CAS')}
  ${reject(call('changed',{stamp:'stamp',hash:'0'.repeat(64)}),'22023','HASH')}
  execute 'reset role';
  if (select to_jsonb(t) from public.items t where id=i)<>item_snapshot then raise exception 'C3_ATOMIC_REJECT'; end if;
  begin update public.connections set scopes=array_remove(granted,'https://www.googleapis.com/auth/calendar.events.owned.readonly') where id=c;
    perform ${call('changed',{stamp:'stamp'})}; raise exception 'C3_SCOPE'; exception when invalid_parameter_value then null; end;
  begin delete from private.google_connection_tokens where connection_id=c;
    perform ${call('changed',{stamp:'stamp'})}; raise exception 'C3_TOKEN'; exception when invalid_parameter_value then null; end;
  execute 'set local role service_role'; r:=${call('changed',{stamp:'stamp'})}; execute 'reset role';
  if r->>'outcome'<>'updated' or r->>'item_id'<>i::text then raise exception 'C3_UPDATE'; end if;
  select to_jsonb(t),updated_at into item_snapshot,stamp from public.items t where id=i;
  execute 'set local role service_role';
  ${reject(call('normal',{stamp:'stamp'}),'40001','STALE_SOURCE')}
  r:=${call('cancel',{stamp:'stamp'})}; execute 'reset role';
  if r->>'outcome'<>'updated' or r->>'item_id'<>i::text or not exists(select 1 from public.items where id=i and metadata#>>'{calendar,status}'='cancelled' and content_text=item_snapshot->>'content_text' and metadata#>'{calendar,start}'=item_snapshot#>'{metadata,calendar,start}' and original_url is not distinct from item_snapshot->>'original_url') then raise exception 'C3_CANCEL'; end if;
  select to_jsonb(t),updated_at into item_snapshot,stamp from public.items t where id=i;
  execute 'set local role service_role'; r:=${call('cancel',{stamp:'stamp'})}; execute 'reset role';
  if r->>'outcome'<>'reused' or (select to_jsonb(t) from public.items t where id=i)<>item_snapshot then raise exception 'C3_CANCEL_REUSE'; end if;
  execute 'set local role service_role'; r:=${call('unknown')}; execute 'reset role';
  if r->>'outcome'<>'skipped' or exists(select 1 from public.items where user_id=u and external_id='unknown') then raise exception 'C3_UNKNOWN_CANCEL'; end if;
  execute 'set local role service_role'; r:=${call('allday')}; execute 'reset role';
  if r->>'outcome'<>'created' or not exists(select 1 from public.items where user_id=u and external_id='allday' and source_created_at is null and source_updated_at is null and metadata#>>'{calendar,start,date}'='2026-10-05' and metadata#>>'{calendar,end,date}'='2026-10-07' and metadata#>>'{calendar,recurringEventId}'='master') then raise exception 'C3_DATES'; end if;
  if (select count(*) from public.items where user_id=u and external_id='event1')<>1 or (select to_jsonb(t) from public.classifications t where item_id=i)<>class_snapshot or (select to_jsonb(t) from public.actions t where id=a)<>action_snapshot or (select to_jsonb(t) from public.action_sources t where item_id=i)<>evidence_snapshot or not exists(select 1 from public.items where id=i and metadata#>>'{aiAnalysis,keep}'='true' and metadata->>'custom'='keep') then raise exception 'C3_GRAPH'; end if;
  update public.connections set sync_state='{"gmail":{"history_id":"123","initial_collection":{"complete":true}},"drive":{"keep":true}}',last_synced_at='2026-09-01',connected_at='2026-08-01' where id=c;
  select to_jsonb(t) into conn_snapshot from public.connections t where id=c;
  select to_jsonb(t) into token_snapshot from private.google_connection_tokens t where connection_id=c;
  foreach removed in array array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/drive.metadata.readonly','https://www.googleapis.com/auth/documents.readonly','https://www.googleapis.com/auth/calendar.events.owned.readonly'] loop
    begin perform public.upgrade_google_calendar_scopes(u,c,'calendar3-fixture','fixture@example.invalid',array_remove(granted,removed),(conn_snapshot->>'updated_at')::timestamptz,'synthetic-access','new','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour',1::smallint); raise exception 'C3_PARTIAL_GRANT'; exception when invalid_parameter_value then null; end;
  end loop;
  ${reject("public.upgrade_google_calendar_scopes(other_u,c,'calendar3-fixture','fixture@example.invalid',granted,(conn_snapshot->>'updated_at')::timestamptz,'synthetic-access','new','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour',1::smallint)",'40001','FOREIGN_UPGRADE')}
  ${reject("public.upgrade_google_calendar_scopes(u,c,'other-account','fixture@example.invalid',granted,(conn_snapshot->>'updated_at')::timestamptz,'synthetic-access','new','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour',1::smallint)",'40001','ACCOUNT_UPGRADE')}
  ${reject("public.upgrade_google_calendar_scopes(u,c,'calendar3-fixture','fixture@example.invalid',granted,(conn_snapshot->>'updated_at')::timestamptz,'stale','new','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour',1::smallint)",'40001','TOKEN_CAS')}
  if (select to_jsonb(t) from public.connections t where id=c)<>conn_snapshot or (select to_jsonb(t) from private.google_connection_tokens t where connection_id=c)<>token_snapshot then raise exception 'C3_UPGRADE_ATOMIC'; end if;
  perform public.upgrade_google_calendar_scopes(u,c,'calendar3-fixture','fixture@example.invalid',granted,(conn_snapshot->>'updated_at')::timestamptz,'synthetic-access','new','iv','tag','synthetic-refresh','iv','tag',now()+interval '1 hour',1::smallint);
  if not exists(select 1 from public.connections where id=c and sync_state=conn_snapshot->'sync_state' and last_synced_at=(conn_snapshot->>'last_synced_at')::timestamptz and connected_at=(conn_snapshot->>'connected_at')::timestamptz) then raise exception 'C3_CHECKPOINT'; end if;
  perform set_config('request.jwt.claim.sub',other_u::text,true); execute 'set local role authenticated';
  if exists(select 1 from public.items where id=i) or exists(select 1 from public.classifications where item_id=i) or exists(select 1 from public.action_sources where item_id=i) then raise exception 'C3_FOREIGN_RLS'; end if;
  execute 'reset role'; perform set_config('request.jwt.claim.sub',u::text,true); execute 'set local role authenticated';
  if not exists(select 1 from public.items where id=i) then raise exception 'C3_OWNER_RLS'; end if;
  perform public.disconnect_google_connection(c); execute 'reset role';
  ${reject(call('changed',{stamp:'stamp'}),'22023','DISCONNECT')}
  if (select to_jsonb(t) from public.items t where id=i)<>item_snapshot then raise exception 'C3_DISCONNECT_PRESERVE'; end if;
  perform set_config('request.jwt.claim.sub','',true); execute 'set local role anon';
  begin if exists(select 1 from public.items where id=i) then raise exception 'C3_ANON_RLS'; end if; exception when insufficient_privilege then null; end;
  execute 'reset role'; execute 'set constraints all immediate';
end $test$;
select true as calendar_runtime_pass;
rollback;`;
try {
  const before=query(snapshotSql)[0];
  assert.equal(query(sql)[0].calendar_runtime_pass,true);
  assert.deepEqual(query(snapshotSql)[0],before);
  console.log("PASS: real dev DB create/reuse/update/CAS/stale/hash/known+unknown cancellation/all-day/recurring/null dates/User Edited/Action/Evidence, partial Scope/foreign/token CAS/checkpoints, owner/foreign/anon RLS and disconnect. All synthetic fixtures rolled back; existing data unchanged.");
} catch(error) { console.error(`FAIL: Calendar runtime (${error.message ?? "details suppressed"}).`); process.exitCode=1; }
