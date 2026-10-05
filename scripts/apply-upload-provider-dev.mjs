import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {query,quote,requireDev} from './calendar-dev-db.mjs';
const version='20261005093526',name='upload_provider_neutral_rpc',filename=`${version}_${name}.sql`;
const old=readFileSync('scripts/apply-upload-dev.mjs','utf8');
let snapshot=old.match(/const snapshot=`([\s\S]*?)`;/)[1].replaceAll('${version}',version);
snapshot=snapshot.replace("and p.prokind='f'", "and p.prokind='f' and p.proname<>'upload_session_rpc'");
snapshot=snapshot.replace(" where id<>'upload-originals'",'');
snapshot=snapshot.replace(" select 'users',count(*)::text from auth.users)"," select 'sessions',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from private.upload_sessions t union all select 'objects',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from storage.objects t union all select 'users',count(*)::text from auth.users)");
let stage='local-preflight';
try {
 requireDev();assert.equal(process.env.UPLOAD_DB_TEST_PROJECT,'oclzdppdiljbojvqtkeu');
 const sql=readFileSync(`supabase/migrations/${filename}`,'utf8');
 assert.equal(createHash('sha256').update(sql).digest('hex'),'39e815ff647cbb7bdc4910d1d420a738af5ede54dc0f31ea4cc95bdfc34a38b7');
 const body=sql.match(/as \$\$([\s\S]*?)\$\$/)[1];
 const outer=sql.replace(/--[^\n]*/g,'').replace(/as \$\$[\s\S]*?\$\$/,'as $$BODY$$');
 assert.equal((outer.match(/create or replace function/g)||[]).length,1);
 assert.ok(!/\b(table|column|index|policy|insert|update|delete|drop|truncate|alter)\b/i.test(outer));
 assert.ok(outer.includes('security definer set search_path=\'\''));
 assert.ok(outer.includes('from public,anon,authenticated;'));
 assert.ok(outer.includes('to service_role;'));
 stage='remote-preflight';
 const history=query('select version from supabase_migrations.schema_migrations order by version');
 const local=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).map(f=>f.slice(0,14));
 assert.deepEqual(history.filter(h=>!local.includes(h.version)).map(h=>h.version),['20261003103041','20261003104321']);
 assert.ok(local.every(v=>v===version||history.some(h=>h.version===v)));
 const before=query(snapshot);writeFileSync('supabase/.temp/upload3-provider-before.json',JSON.stringify(before));
 if(!history.some(h=>h.version===version)) {
  const original=readFileSync('supabase/migrations/20261005070410_upload_storage_session_boundary.sql','utf8');
  const originalBody=original.match(/create function public\.upload_session_rpc\([\s\S]*?as \$\$([\s\S]*?)\$\$/)[1];
  assert.equal(query(`select prosrc=${quote(originalBody)} ok from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure`)[0].ok,true);
  console.log('PASS: exact approved hash, one RPC only, no schema/Storage/RLS changes, dev target and original RPC/history verified.');
  if(!process.argv.includes('--apply'))process.exit(0);
  stage='apply';
  const ddl=sql.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
  assert.equal(query(`begin;${ddl}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(version)},${quote(name)},array[${quote(sql)}]);select true applied;commit;`)[0].applied,true);
 }
 stage='preservation';
 const after=new Map(query(snapshot).map(r=>[r.k,r.v]));assert.equal(after.size,before.length);
 for(const row of before)assert.equal(after.get(row.k),row.v,'Existing object/data changed');
 const predicates=[`prosrc=${quote(body)}`,`prosecdef`,`'search_path=""'=any(proconfig)`,`not has_function_privilege('anon',oid,'execute')`,`not has_function_privilege('authenticated',oid,'execute')`,`has_function_privilege('service_role',oid,'execute')`];
 assert.equal(query(`select ${predicates.join(' and ')} ok from pg_proc where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure`)[0].ok,true);
 const registered=query(`select name,statements from supabase_migrations.schema_migrations where version=${quote(version)}`)[0];assert.equal(registered.name,name);assert.deepEqual(registered.statements,[sql]);
 const remote=query('select version from supabase_migrations.schema_migrations order by version');assert.ok(local.every(v=>remote.some(h=>h.version===v)));assert.equal(remote.length,history.length+(history.some(h=>h.version===version)?0:1));
 writeFileSync('supabase/.temp/upload3-provider-result.json',JSON.stringify({version,applied:true,preservation:true,history:remote.map(r=>r.version)}));
 console.log('PASS: only approved migration applied; existing data/sessions/objects/buckets/schema/indexes/RLS/other RPCs/history unchanged; exact RPC body and service-only privileges verified.');
 console.log('PASS: all local migration versions present remotely; two initial remote-only versions preserved.');
} catch {console.error(`FAIL: provider migration at ${stage}; SQL/data/credential details suppressed.`);process.exitCode=1;}
