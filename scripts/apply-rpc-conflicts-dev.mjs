// Explicit shared-dev apply; refuses until server-first and Upload HTTP smoke evidence passed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {query,quote,snapshotSql} from './calendar-dev-db.mjs';
import {migration,conflictNames} from './rpc-conflicts-migration.mjs';
assert.equal(process.env.RPC_CONFLICT_APPLY,'YES');
const smoke=JSON.parse(readFileSync('supabase/.temp/rpc-conflict-production-before.json','utf8'));
for(const key of ['google','search','driveRead','driveSync','calendarRead','calendarSync','sessionRevoked'])assert.equal(smoke[key],true);
assert.ok(!smoke.failedStage&&smoke.requests.every(r=>r.status===200));
const upload=JSON.parse(readFileSync('supabase/.temp/upload-cpu-production-result.json','utf8'));
for(const key of ['upload','ocr','complete','reuse','gemini','item','cleanup'])assert.equal(upload[key],true);
assert.ok(Date.parse(upload.startedAt)>=Date.parse(smoke.startedAt));
const deployment=JSON.parse(readFileSync('supabase/.temp/rpc-conflict-server-deploy.json','utf8'));assert.equal(deployment.ready,true);assert.ok(Date.parse(deployment.readyAt)<=Date.parse(smoke.startedAt));
const version='20261010021425',name='nonretryable_rpc_conflicts',names=conflictNames.map(quote).join(',');
const ddl=migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
const protectedData=`select to_jsonb(t)-'functions'-'history' as data from (${snapshotSql.replace(/;\s*$/,'')}) t`;
const otherFunctions=`select md5(jsonb_agg(jsonb_build_array(pg_get_functiondef(p.oid),p.proacl,p.proowner) order by p.oid)::text) fingerprint from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace) and p.prokind='f' and p.proname not in (${names})`;
try{
 assert.equal(query(`select count(*)::int n from supabase_migrations.schema_migrations where version=${quote(version)}`)[0].n,0);
 query(`begin;set local lock_timeout='5s';set local statement_timeout='20s';
 create temporary table protected_data on commit drop as ${protectedData};
 create temporary table protected_functions on commit drop as ${otherFunctions};
 create temporary table rpc_before on commit drop as select p.oid,p.prosrc,to_jsonb(p)-'prosrc' contract from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (${names});
 ${ddl}
 do $verify$ begin
 if (select count(*) from rpc_before)<>6 then raise exception 'C3_FUNCTION_COUNT';end if;
 if exists(select 1 from rpc_before b join pg_proc p on p.oid=b.oid where p.prosrc<>replace(b.prosrc,'errcode=''40001''','errcode=''PT409''') or to_jsonb(p)-'prosrc'<>b.contract) then raise exception 'C3_CONTRACT';end if;
 if (select sum((length(prosrc)-length(replace(prosrc,'errcode=''40001''','')))/length('errcode=''40001''')) from rpc_before)<>14 then raise exception 'C3_CONFLICT_COUNT';end if;
 if (select data from protected_data) is distinct from (${protectedData}) then raise exception 'C3_DATA_SCHEMA_RLS_CHANGED';end if;
 if (select fingerprint from protected_functions) is distinct from (${otherFunctions}) then raise exception 'C3_OTHER_FUNCTIONS_CHANGED';end if;
 end $verify$;
 insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},${quote(name)},array[${quote(migration)}]);select true applied;commit;`);
 const counts=query(`select count(*)::int functions,sum((length(prosrc)-length(replace(prosrc,'errcode=''PT409''','')))/length('errcode=''PT409'''))::int conflicts from pg_proc where pronamespace='public'::regnamespace and proname in (${names})`)[0];assert.equal(counts.functions,6);assert.equal(counts.conflicts,14);
 const history=query(`select name,statements from supabase_migrations.schema_migrations where version=${quote(version)}`)[0];assert.equal(history.name,name);assert.deepEqual(history.statements,[migration]);
 writeFileSync('supabase/.temp/rpc-conflict-apply-result.json',JSON.stringify({project:'oclzdppdiljbojvqtkeu',version,applied:true,functions:6,conflicts:14,contractsPreserved:true,dataSchemaRlsPreserved:true,checkedAt:new Date().toISOString()}));
 console.log('PASS: server-first smoke gate; shared dev migration/history applied atomically; six functions/14 literals only, full pg_proc attributes/other functions/data/schema/RLS unchanged.');
}catch(error){console.error('FAIL: shared-dev conflict apply '+(error.message?.startsWith('DB check failed')?error.message:'verification failed; details suppressed'));process.exitCode=1;}
