// Direct PostgreSQL rehearsal only: the entire six-function migration and synthetic RPC data roll back.
// No PostgREST call with an old application 40001 and no persistent function/data change.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {query,snapshotSql} from './calendar-dev-db.mjs';
import {migration,conflictNames} from './rpc-conflicts-migration.mjs';
const before=query(snapshotSql)[0];
const functions=()=>query("select md5(jsonb_agg(jsonb_build_array(pg_get_functiondef(p.oid),p.proacl,p.proowner) order by p.oid)::text) fingerprint from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace) and p.prokind='f'")[0];
const oldFunctions=functions();
const ddl=migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
const sql=`begin;set local lock_timeout='5s';set local statement_timeout='20s';
create temporary table rpc_contract_before on commit drop as select oid,prosrc,pg_get_function_identity_arguments(oid) args,pg_get_function_result(oid) result,prosecdef,proconfig,proacl,proowner,provolatile,proparallel,proisstrict from pg_proc where pronamespace='public'::regnamespace and proname in (${conflictNames.map(n=>"'"+n+"'").join(',')});
${ddl}
${ddl}
do $test$
declare u uuid:=gen_random_uuid();i uuid:=gen_random_uuid();r jsonb;attempt uuid;stamp timestamptz;version text:='gemini-embedding-2:768:retrieval-v1:chunk-v1';payload jsonb;message text;
begin
 if (select count(*) from rpc_contract_before)<>6 then raise exception 'C3_FUNCTION_COUNT';end if;
 if exists(select 1 from rpc_contract_before b join pg_proc p on p.oid=b.oid where p.prosrc<>replace(b.prosrc,'errcode=''40001''','errcode=''PT409''') or row(b.args,b.result,b.prosecdef,b.proconfig,b.proacl,b.proowner,b.provolatile,b.proparallel,b.proisstrict) is distinct from row(pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),p.prosecdef,p.proconfig,p.proacl,p.proowner,p.provolatile,p.proparallel,p.proisstrict)) then raise exception 'C3_CONTRACT';end if;
 insert into auth.users(id,email,raw_user_meta_data) values(u,'rpc-conflict-'||u||'@example.invalid','{}');
 insert into public.items(id,user_id,title,content_text,source,format) values(i,u,'synthetic conflict search','synthetic conflict search body','manual','text');
 execute 'set local role service_role';
 r:=public.search_candidates(u,version,'synthetic conflict search',null,'{"source":[],"format":[]}', '{"kind":"documents"}');
 if jsonb_array_length(r)<>1 then raise exception 'C3_SEARCH_NORMAL';end if;
 payload:=jsonb_build_object('key',repeat('a',64),'version',version);
 r:=public.search_runtime('query_claim',u,payload);attempt:=(r->>'attempt')::uuid;
 if r->>'state'<>'claimed' then raise exception 'C3_CACHE_CLAIM';end if;
 begin perform public.search_runtime('query_release',u,payload||jsonb_build_object('attempt',gen_random_uuid()));raise exception 'C3_CACHE_ACCEPTED';exception when sqlstate 'PT409' then get stacked diagnostics message=message_text;if message<>'SEARCH_CACHE_STALE' then raise exception 'C3_CACHE_MESSAGE';end if;end;
 perform public.search_runtime('query_release',u,payload||jsonb_build_object('attempt',attempt));
 select updated_at into stamp from public.items where id=i;
 payload:=jsonb_build_object('snapshot',stamp,'fingerprint',repeat('b',64),'chunkCount',1,'semantic',false);
 begin perform public.search_index('claim',u,i,version,payload||jsonb_build_object('snapshot',stamp-interval '1 second'));raise exception 'C3_SNAPSHOT_ACCEPTED';exception when sqlstate 'PT409' then get stacked diagnostics message=message_text;if message<>'SEARCH_STALE_INPUT' then raise exception 'C3_SNAPSHOT_MESSAGE';end if;end;
 r:=public.search_index('claim',u,i,version,payload);attempt:=(r->>'attempt')::uuid;
 begin perform public.search_index('claim',u,i,version,payload);raise exception 'C3_BUSY_ACCEPTED';exception when lock_not_available then null;end;
 begin perform public.search_index('finish',u,i,version,'{}',gen_random_uuid());raise exception 'C3_ATTEMPT_ACCEPTED';exception when sqlstate 'PT409' then get stacked diagnostics message=message_text;if message<>'SEARCH_INDEX_STALE' then raise exception 'C3_ATTEMPT_MESSAGE';end if;end;
 perform public.search_index('release',u,i,version,'{}',attempt);
 execute 'reset role';
end $test$;
select true as rehearsal_pass;
rollback;`;
try{
 assert.equal(query(sql)[0].rehearsal_pass,true);assert.deepEqual(query(snapshotSql)[0],before);assert.deepEqual(functions(),oldFunctions);
 writeFileSync('supabase/.temp/rpc-conflicts-rehearsal-result.json',JSON.stringify({project:'oclzdppdiljbojvqtkeu',checkedAt:new Date().toISOString(),allSixContracts:true,idempotent:true,searchRpc:true,rolledBack:true,existingDataAndDefinitionsUnchanged:true}));
 console.log('PASS: real dev PostgreSQL all-six migration twice/contract/body-only guard and normal Search/cache/snapshot/lease RPCs. Entire DDL/data rolled back; existing data/definitions/schema/RLS/history unchanged.');
}catch(error){console.error('FAIL: RPC conflict rehearsal '+(error.message?.startsWith('DB check failed')?error.message:'verification failed; data suppressed'));process.exitCode=1;}
