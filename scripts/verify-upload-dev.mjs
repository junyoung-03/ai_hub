import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {query,quote} from './calendar-dev-db.mjs';
try{
 const filename='20261005070410_upload_storage_session_boundary.sql';const sql=readFileSync(`supabase/migrations/${filename}`,'utf8');assert.equal(sql,readFileSync(`tests/fixtures/sql/upload/${filename}`,'utf8'));
 const predicates=[`exists(select 1 from supabase_migrations.schema_migrations where version='20261005070410'and name='upload_storage_session_boundary'and statements=array[${quote(sql)}])`];
 const functions=[...sql.matchAll(/create function public\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$/gi)];assert.equal(functions.length,3);
 const followup=readFileSync('supabase/migrations/20261005093526_upload_provider_neutral_rpc.sql','utf8');
 predicates.push(`exists(select 1 from supabase_migrations.schema_migrations where version='20261005093526'and name='upload_provider_neutral_rpc'and statements=array[${quote(followup)}])`);
 const cpuFix=readFileSync('supabase/migrations/20261010011615_upload_stale_attempt_nonretryable.sql','utf8');
 predicates.push(`exists(select 1 from supabase_migrations.schema_migrations where version='20261010011615'and name='upload_stale_attempt_nonretryable'and statements=array[${quote(cpuFix)}])`);
 const currentBody=cpuFix.match(/as \$\$([\s\S]*?)\$\$/)[1];
 for(const [,name,body]of functions)predicates.push(`exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=${quote(name)}and p.prosrc=${quote(name==='upload_session_rpc'?currentBody:body)}and p.prosecdef and 'search_path=""'=any(p.proconfig))`);
 assert.equal(query(`select ${predicates.join(' and ')}exact`)[0].exact,true);
 const local=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).map(f=>f.slice(0,14)),history=query('select version from supabase_migrations.schema_migrations order by version');
 assert.ok(local.every(v=>history.some(h=>h.version===v)));assert.deepEqual(history.filter(h=>!local.includes(h.version)).map(h=>h.version),['20261003103041','20261003104321']);
 console.log('PASS: exact local/remote Upload function bodies, SECURITY DEFINER/search_path, migration version/name/statements; all local versions present, two initial remote-only versions retained.');
}catch{console.error('FAIL: Upload remote/local verification; query/data suppressed.');process.exitCode=1;}
