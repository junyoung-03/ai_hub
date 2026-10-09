// Applies exactly the human-approved Upload draft; preserves initial remote-only history.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {query,quote,requireDev} from './calendar-dev-db.mjs';
const version='20261005070410',name='upload_storage_session_boundary';
const filename=`${version}_${name}.sql`;
const snapshot=`select 'data.'||name k,hash v from (
 select 'connections' name,md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))hash from public.connections t union all
 select 'tokens',md5(coalesce(jsonb_agg(to_jsonb(t)order by connection_id)::text,''))from private.google_connection_tokens t union all
 select 'items',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.items t union all
 select 'classifications',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.classifications t union all
 select 'actions',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.actions t union all
 select 'evidence',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.action_sources t union all
 select 'users',count(*)::text from auth.users) d
 union all select 'column.'||table_schema||'.'||table_name||'.'||column_name,md5(to_jsonb(t)::text)from information_schema.columns t where table_schema in('public','private','storage')
 union all select 'index.'||schemaname||'.'||indexname,md5(indexdef)from pg_indexes where schemaname in('public','private','storage')
 union all select 'policy.'||schemaname||'.'||tablename||'.'||policyname,md5(to_jsonb(t)::text)from pg_policies t where schemaname in('public','private','storage')
 union all select 'table.'||n.nspname||'.'||c.relname,md5(jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl)::text)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','storage')and c.relkind in('r','p')
 union all select 'constraint.'||c.oid,md5(pg_get_constraintdef(c.oid))from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in('public','private','storage')
 union all select 'trigger.'||t.oid,md5(pg_get_triggerdef(t.oid))from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','storage')
 union all select 'function.'||p.oid,md5(jsonb_build_array(pg_get_functiondef(p.oid),p.proacl)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','storage')and p.prokind='f'
 union all select 'history.'||version,md5(to_jsonb(t)::text)from supabase_migrations.schema_migrations t where version<>'${version}'
 union all select 'bucket.'||id,md5(to_jsonb(t)::text)from storage.buckets t where id<>'upload-originals';`;
try{
 requireDev();assert.equal(process.env.UPLOAD_DB_TEST_PROJECT,'oclzdppdiljbojvqtkeu');
 const sql=readFileSync(`tests/fixtures/sql/upload/${filename}`,'utf8');assert.equal(sql,readFileSync(`supabase/migrations/${filename}`,'utf8'));
 assert.ok(!/\b(drop|truncate)\b/i.test(sql));assert.equal((sql.match(/alter table /g)||[]).length,1);assert.ok(sql.includes('alter table private.upload_sessions enable row level security;'));
 assert.ok(sql.includes("('upload-originals','upload-originals',false,5000000"));assert.ok(!/create policy .*for (update|delete)/i.test(sql));
 const history=query('select version from supabase_migrations.schema_migrations order by version');
 const local=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).map(f=>f.slice(0,14));
 assert.deepEqual(history.filter(h=>!local.includes(h.version)).map(h=>h.version),['20261003103041','20261003104321']);
 assert.ok(local.every(v=>v===version||history.some(h=>h.version===v)));
 const before=query(snapshot);writeFileSync('supabase/.temp/upload3-before-migration.json',JSON.stringify(before));
 if(!history.some(h=>h.version===version)){
   const absent=query("select to_regclass('private.upload_sessions') is null and not exists(select 1 from storage.buckets where id='upload-originals') ready")[0];assert.equal(absent.ready,true);
   if(!process.argv.includes('--apply')){console.log('PASS: exact approved draft, target/history and existing-object preservation baseline; no changes.');process.exit(0);}
   const body=sql.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
   assert.equal(query(`begin;${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(version)},${quote(name)},array[${quote(sql)}]);select true applied;commit;`)[0].applied,true);
 }
 const after=new Map(query(snapshot).map(r=>[r.k,r.v]));for(const row of before)assert.equal(after.get(row.k),row.v,'Existing object/data changed');
 const registered=query(`select version,name,statements from supabase_migrations.schema_migrations where version=${quote(version)}`)[0];assert.equal(registered.name,name);assert.deepEqual(registered.statements,[sql]);
 // Two service-only RPCs and one owner-limited authenticated predicate.
 const rights=query("select not has_function_privilege('anon','public.owns_upload_object(text,boolean)','execute') and has_function_privilege('authenticated','public.owns_upload_object(text,boolean)','execute') ok")[0];assert.equal(rights.ok,true);
 assert.equal(query("select count(*)=2 and bool_and(prosecdef and 'search_path=\"\"'=any(proconfig) and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute'))ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('upload_session_rpc','upload_cleanup_candidates')")[0].ok,true);
 const policies=query("select policyname,cmd from pg_policies where schemaname='storage'and tablename='objects'and policyname in('upload_objects_insert','upload_objects_select')");assert.equal(policies.length,2);
 const bucket=query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='upload-originals'")[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5000000);assert.deepEqual(bucket.allowed_mime_types,['application/pdf','image/png','image/jpeg']);
 writeFileSync('supabase/.temp/upload3-migration-result.json',JSON.stringify({version,applied:true,preservation:true,privateBucket:true}));
 console.log('PASS: approved Upload migration only, exact history/statements, private bucket/policies/service boundary; existing data/tokens/schema objects and remote-only history preserved.');
}catch{console.error('FAIL: Upload migration preflight/application verification; SQL/data/provider details suppressed.');process.exitCode=1;}
