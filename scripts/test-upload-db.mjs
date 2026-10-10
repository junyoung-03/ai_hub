// Real dev DB synthetic transaction; rolls back users, sessions, ITEMs and analysis sentinels.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {load} from './calendar-loader.mjs';
import {query,quote} from './calendar-dev-db.mjs';
const c=load('src/lib/uploads/contract.ts'),request={fileName:'synthetic.pdf',mimeType:'application/pdf',size:100};
const text=c.assemble([{text:'Synthetic text',method:'embedded',confidence:null}]);
const call=(op,{user='u',id='sid',key='k',req=request,payload=null,attempt='null'}={})=>`public.upload_session_rpc(${quote(op)},${user},${id},${key},${quote(JSON.stringify(req))}::jsonb,${quote(JSON.stringify(payload))}::jsonb,${attempt})`;
const reject=(expression,state,label)=>`begin perform ${expression};raise exception 'C3_UPLOAD_${label}';exception when sqlstate '${state}' then null;end;`;
const raw=c.sha256('upload3 synthetic bytes');
const snapshot=`select (select md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.items t)items,
 (select md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.classifications t)classifications,
 (select md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.actions t)actions,
 (select md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.action_sources t)evidence,
 (select md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.connections t)connections,
 (select md5(coalesce(jsonb_agg(to_jsonb(t)order by connection_id)::text,''))from private.google_connection_tokens t)tokens,
 (select count(*)from auth.users)users,(select count(*)from private.upload_sessions)sessions;`;
const sql=`begin;do $test$
declare u uuid:=gen_random_uuid();other_u uuid:=gen_random_uuid();k uuid:=gen_random_uuid();sid uuid;sid2 uuid;i uuid;a uuid:=gen_random_uuid();attempt uuid;r jsonb;before_item jsonb;graph jsonb;p text;
begin
 insert into auth.users(id,email,raw_user_meta_data)values(u,'upload3-'||u||'@example.invalid','{}'),(other_u,'upload3-'||other_u||'@example.invalid','{}');
 execute 'set local role service_role';
 r:=${call('create',{id:'null'})};sid:=(r->>'id')::uuid;p:=r->>'path';
 if (${call('create',{id:'null'})}->>'id')::uuid<>sid then raise exception 'C3_UPLOAD_KEY_REPLAY';end if;
 ${reject(call('create',{id:'null',req:{...request,size:101}}),'23505','KEY_CONFLICT')}
 ${reject(call('read',{user:'other_u'}),'22023','FOREIGN_SESSION')}
 ${reject(call('create',{id:'null',key:'gen_random_uuid()',req:{...request,fileName:'../bad.pdf'}}),'22023','UNSAFE_NAME')}
 r:=${call('pending',{payload:{rawHash:raw}})};i:=(r->>'itemId')::uuid;
 execute 'reset role';
 if not exists(select 1 from public.items where id=i and source='upload'and format='pdf'and external_id=sid::text and connection_id is null and external_container_id is null and original_url is null and storage_path=u::text||'/'||sid::text||'/original.pdf'and processing_status='queued'and content_text is null)then raise exception 'C3_UPLOAD_MAPPING';end if;
 insert into public.classifications(user_id,item_id,ai_primary_topic,user_primary_topic,user_document_type,user_tags)values(u,i,'Synthetic AI sentinel','User override','general','{}');
 insert into public.actions(id,user_id,title,action_type)values(a,u,'Synthetic action','check');
 insert into public.action_sources(user_id,action_id,item_id,evidence_text,evidence_locator)values(u,a,i,'Synthetic','{"start":0,"end":9}');
 update public.items set metadata=metadata||'{"aiAnalysis":{"keep":true}}'::jsonb where id=i;
 select jsonb_build_array((select to_jsonb(t)from public.classifications t where item_id=i),(select to_jsonb(t)from public.actions t where id=a),(select to_jsonb(t)from public.action_sources t where item_id=i))into graph;
 execute 'set local role service_role';r:=${call('reserve',{payload:{leaseMs:120000}})};attempt:=(r->>'attempt')::uuid;
 ${reject(call('reserve'),'55P03','CONCURRENT')}
 r:=${call('claim',{attempt:'attempt'})};attempt:=(r->>'attempt')::uuid;
 ${reject(call('finish',{attempt:'gen_random_uuid()',payload:text}),'PT409','STALE_ATTEMPT')}
 r:=${call('fail',{attempt:'attempt',payload:{error:'OCR_FAILED'}})};
 execute 'reset role';if not exists(select 1 from public.items where id=i and processing_status='failed'and content_text is null)then raise exception 'C3_UPLOAD_FAIL_PARTIAL';end if;
 execute 'set local role service_role';r:=${call('claim')};attempt:=(r->>'attempt')::uuid;
 ${reject(call('finish',{attempt:'attempt',payload:{...text,hash:'0'.repeat(64)}}),'22023','TEXT_HASH')}
 r:=${call('finish',{attempt:'attempt',payload:text})};execute 'reset role';
 if not exists(select 1 from public.items where id=i and content_text=${quote(text.text)}and content_hash=${quote(text.hash)}and processing_status='queued'and metadata#>>'{upload,extraction,status}'='complete'and metadata#>>'{aiAnalysis,keep}'='true')then raise exception 'C3_UPLOAD_COMPLETE';end if;
 if graph<>jsonb_build_array((select to_jsonb(t)from public.classifications t where item_id=i),(select to_jsonb(t)from public.actions t where id=a),(select to_jsonb(t)from public.action_sources t where item_id=i))then raise exception 'C3_UPLOAD_GRAPH';end if;
 select to_jsonb(t)into before_item from public.items t where id=i;
 execute 'set local role service_role';r:=${call('create',{id:'null',key:'gen_random_uuid()',req:{...request,fileName:'renamed.pdf'}})};sid2:=(r->>'id')::uuid;
 r:=${call('pending',{id:'sid2',payload:{rawHash:raw}})};if r->>'state'<>'reused'or (r->>'itemId')::uuid<>i then raise exception 'C3_UPLOAD_DEDUPE';end if;
 execute 'reset role';if (select to_jsonb(t)from public.items t where id=i)<>before_item then raise exception 'C3_UPLOAD_REUSE_MUTATED';end if;
 execute 'set local role service_role';r:=${call('create',{id:'null',key:'gen_random_uuid()'})};sid2:=(r->>'id')::uuid;r:=${call('pending',{id:'sid2',payload:{rawHash:c.sha256('other bytes')}})};
 if (r->>'itemId')::uuid=i then raise exception 'C3_UPLOAD_DIFFERENT_BYTES';end if;
 r:=${call('claim',{id:'sid2'})};attempt:=(r->>'attempt')::uuid;execute 'reset role';
 update private.upload_sessions set lease_until=clock_timestamp()-interval '1 second'where id=sid2;
 execute 'set local role service_role';${reject(call('finish',{id:'sid2',attempt:'attempt',payload:text}),'PT409','EXPIRED_LEASE')}
 execute 'reset role';perform set_config('request.jwt.claim.sub',u::text,true);execute 'set local role authenticated';
 if (select count(*)from public.items where id=i)<>1 or not public.owns_upload_object(p,false)or public.owns_upload_object(u::text||'/../original.pdf',false)then raise exception 'C3_UPLOAD_OWNER_RLS';end if;
 ${reject(call('read'),'42501','SERVER_RPC')}
 execute 'reset role';perform set_config('request.jwt.claim.sub',other_u::text,true);execute 'set local role authenticated';
 if exists(select 1 from public.items where id=i)or public.owns_upload_object(p,false)then raise exception 'C3_UPLOAD_FOREIGN_RLS';end if;
 execute 'reset role';perform set_config('request.jwt.claim.sub','',true);execute 'set local role anon';
 begin if exists(select 1 from public.items where id=i)then raise exception 'C3_UPLOAD_ANON_RLS';end if;exception when insufficient_privilege then null;end;
 ${reject(`public.owns_upload_object(${quote('arbitrary/path')},false)`,'42501','ANON_PREDICATE')}
 execute 'reset role';
end;$test$;select true passed;rollback;`;
let stage='before-snapshot';
if(process.argv.includes('--save-sql')){writeFileSync('supabase/.temp/upload3-runtime.sql',sql);console.log('Synthetic transaction prepared.');}
else try{const before=query(snapshot)[0];stage='runtime';assert.equal(query(sql)[0].passed,true);stage='preservation';assert.deepEqual(query(snapshot)[0],before);console.log('PASS: real Upload RPC create/pending/complete/fail/retry/dedupe/idempotency/stale/owner/path and authenticated/foreign/anon ITEM RLS; existing graph preserved; synthetic users/data fully rolled back.');}
catch(error){console.error(`FAIL: Upload DB Runtime at ${stage} (${error.message?.startsWith('DB check failed (')?error.message:'safe check failed'}); data/query suppressed.`);process.exitCode=1;}
