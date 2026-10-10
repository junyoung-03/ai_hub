// Dev-only, function-error-handling-only migration. No deploy, compute or user-data changes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {query,quote,requireDev} from './calendar-dev-db.mjs';
const version='20261010011615',name='upload_stale_attempt_nonretryable';
const sql=readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8');
const old=readFileSync('supabase/migrations/20261005093526_upload_provider_neutral_rpc.sql','utf8').split('$$')[1];
const body=sql.split('$$')[1];
assert.equal(body,old.replaceAll("raise exception 'STALE_ATTEMPT' using errcode='40001'","raise sqlstate 'PT409' using message='STALE_ATTEMPT'"));
const snapshot=`select md5(jsonb_build_object(
'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'def',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.proname<>'upload_session_rpc'),
'upload_contract',(select jsonb_build_object('oid',oid,'args',pg_get_function_identity_arguments(oid),'result',pg_get_function_result(oid),'security',prosecdef,'config',proconfig,'acl',proacl,'owner',proowner) from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure),
'tables',(select jsonb_agg(to_jsonb(t) order by t.oid) from (select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','i','S'))t),
'columns',(select jsonb_agg(to_jsonb(t) order by t.table_schema,t.table_name,t.ordinal_position) from information_schema.columns t where table_schema in ('public','private','storage')),
'policies',(select jsonb_agg(to_jsonb(t) order by t.schemaname,t.tablename,t.policyname) from pg_policies t where schemaname in ('public','private','storage')),
'items',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.items t),
'classifications',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.classifications t),
'actions',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.actions t),
'evidence',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.action_sources t),
'sessions',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from private.upload_sessions t),
'connections',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.connections t),
'users',(select count(*) from auth.users))::text) as preserved`;
requireDev();assert.equal(process.env.UPLOAD_DB_TEST_PROJECT,'oclzdppdiljbojvqtkeu');
try{
 const before=query(snapshot)[0];
 const history=query(`select name,statements from supabase_migrations.schema_migrations where version=${quote(version)}`);
 if(!history.length){
  assert.equal(query(`select prosrc=${quote(old)} ok from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure`)[0].ok,true);
  console.log('PASS: dev target, exact original body and eight-only error changes verified.');
  if(!process.argv.includes('--apply'))process.exit(0);
  const ddl=sql.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
  query(`begin;set local lock_timeout='5s';set local statement_timeout='20s';${ddl}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(version)},${quote(name)},array[${quote(sql)}]);select true applied;commit;`);
 }
 assert.equal(query(`select prosrc=${quote(body)} and prosecdef and 'search_path=""'=any(proconfig) and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute') and has_function_privilege('service_role',oid,'execute') ok from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure`)[0].ok,true);
 assert.deepEqual(query(snapshot)[0],before);
 const saved=query(`select name,statements from supabase_migrations.schema_migrations where version=${quote(version)}`)[0];assert.equal(saved.name,name);assert.deepEqual(saved.statements,[sql]);
 writeFileSync('supabase/.temp/upload-cpu-apply-result.json',JSON.stringify({project:'oclzdppdiljbojvqtkeu',version,applied:true,preserved:true,checkedAt:new Date().toISOString()}));
 console.log('PASS: dev migration applied/history exact; function contract/ACL, other functions, schema/table/index/RLS and existing data unchanged.');
}catch(error){console.error('FAIL: dev-only CPU migration:',error.message?.startsWith('DB check failed')?error.message:'verification failed; details suppressed');process.exitCode=1;}
