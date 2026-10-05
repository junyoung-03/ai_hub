-- Search-2. Local draft only; read-only dev preflight: vector 0.8.2/extensions, chunks=0.
-- No personal corpus backfill, provider request, or active-version switch occurs here.
begin;
set local search_path = public, extensions;
do $$ begin
 if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='extensions')
   or exists(select 1 from public.search_chunks) then raise exception 'SEARCH_PREFLIGHT_CHANGED: recheck before applying'; end if;
end $$;
alter table public.search_chunks alter column embedding type vector(768);
alter table public.search_chunks add column embedding_version text not null default 'legacy-unembedded',
  add column content_hash text, add column input_hash text, add column index_fingerprint text,
  add column metadata jsonb not null default '{}'::jsonb;
alter table public.search_chunks add constraint search_chunk_hashes check (
  (content_hash is null or content_hash ~ '^[a-f0-9]{64}$') and
  (input_hash is null or input_hash ~ '^[a-f0-9]{64}$') and
  (index_fingerprint is null or index_fingerprint ~ '^[a-f0-9]{64}$'));
-- Retain independent generations for validate-then-activate model changes.
drop index public.search_chunks_item_chunk_uidx;
create unique index search_chunks_item_version_chunk_uidx on public.search_chunks(item_id,embedding_version,chunk_index) where item_id is not null;
revoke select on public.search_chunks from authenticated;
grant select(id,user_id,item_id,action_id,chunk_index,content,content_tsv,created_at,updated_at,embedding_version,metadata) on public.search_chunks to authenticated;

create table private.search_index_jobs (
  user_id uuid not null, item_id uuid not null, version text not null,
  state text not null default 'pending' check(state in ('pending','running','complete','failed','skipped_limit')),
  fingerprint text, snapshot_updated_at timestamptz, text_revision text,
  chunk_count integer not null default 0 check(chunk_count between 0 and 128),
  next_chunk integer not null default 0 check(next_chunk between 0 and 128),
  semantic boolean not null default false, attempt uuid, lease_until timestamptz,
  retry_count integer not null default 0, retry_after timestamptz, error_code text,
  updated_at timestamptz not null default now(),
  primary key(item_id,version), foreign key(item_id,user_id) references public.items(id,user_id) on delete cascade
);
create table private.search_rates (
  user_id uuid references public.users(id) on delete cascade, category text not null,
  window_start timestamptz not null, used integer not null, primary key(user_id,category)
);
create table private.search_query_cache (
  user_id uuid references public.users(id) on delete cascade, cache_key text not null, version text not null,
  embedding vector(768), attempt uuid, lease_until timestamptz, expires_at timestamptz not null,
  primary key(user_id,cache_key,version)
);
create table private.search_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  context text not null, version text not null, results jsonb not null check(jsonb_typeof(results)='array' and jsonb_array_length(results)<=200),
  info jsonb not null, expires_at timestamptz not null default now()+interval '5 minutes'
);
create index search_sessions_user_expiry on private.search_sessions(user_id,expires_at);
alter table private.search_index_jobs enable row level security;
alter table private.search_rates enable row level security;
alter table private.search_query_cache enable row level security;
alter table private.search_sessions enable row level security;
revoke all on private.search_index_jobs,private.search_rates,private.search_query_cache,private.search_sessions from public,anon,authenticated;
grant select,insert,update,delete on private.search_index_jobs,private.search_rates,private.search_query_cache,private.search_sessions to service_role;
grant usage on schema private,extensions to service_role;

-- Atomic, shared-across-instances quota/cache/snapshot operations. No client-controlled limits.
create function public.search_runtime(p_op text,p_user_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_limit integer; v_used integer; v_window timestamptz:=date_trunc('minute',now());
 v_cache private.search_query_cache; v_session private.search_sessions; v_id uuid; v_offset integer; v_size integer; v_results jsonb;
begin
 if p_user_id is null then raise exception 'SEARCH_OWNER_REQUIRED' using errcode='22023'; end if;
 -- Bounded TTL garbage collection; only this owner, never a global unbounded sweep.
 delete from private.search_sessions where id in(select id from private.search_sessions where user_id=p_user_id and expires_at<=now() limit 100);
 delete from private.search_query_cache where (user_id,cache_key,version) in(select user_id,cache_key,version from private.search_query_cache where user_id=p_user_id and expires_at<=now() and coalesce(lease_until,'-infinity')<=now() limit 100);
 if p_op='rate' then
   if p_payload->>'category' not in ('request','embedding','index') then raise exception 'SEARCH_RATE_CATEGORY' using errcode='22023'; end if;
   v_limit:=case p_payload->>'category' when 'request' then 30 when 'embedding' then 10 else 5 end;
   insert into private.search_rates values(p_user_id,p_payload->>'category',v_window,1)
   on conflict(user_id,category) do update set window_start=excluded.window_start,
     used=case when private.search_rates.window_start=excluded.window_start then private.search_rates.used+1 else 1 end returning used into v_used;
   return jsonb_build_object('allowed',v_used<=v_limit,'retryAfter',greatest(1,ceil(extract(epoch from v_window+interval '1 minute'-now()))::integer));
 elsif p_op='query_claim' then
   if p_payload->>'key' !~ '^[a-f0-9]{64}$' or length(p_payload->>'version')>200 then raise exception 'SEARCH_CACHE_INPUT' using errcode='22023'; end if;
   insert into private.search_query_cache(user_id,cache_key,version,expires_at) values(p_user_id,p_payload->>'key',p_payload->>'version',now()+interval '5 minutes') on conflict do nothing;
   select * into v_cache from private.search_query_cache where user_id=p_user_id and cache_key=p_payload->>'key' and version=p_payload->>'version' for update;
   if v_cache.embedding is not null and v_cache.expires_at>now() then return jsonb_build_object('state','cached','embedding',v_cache.embedding::text); end if;
   if v_cache.lease_until>now() then return jsonb_build_object('state','busy'); end if;
   v_id:=gen_random_uuid(); update private.search_query_cache set embedding=null,attempt=v_id,lease_until=now()+interval '20 seconds',expires_at=now()+interval '5 minutes'
     where user_id=p_user_id and cache_key=v_cache.cache_key and version=v_cache.version;
   return jsonb_build_object('state','claimed','attempt',v_id);
 elsif p_op in ('query_finish','query_release') then
   update private.search_query_cache set embedding=case when p_op='query_finish' then (p_payload->>'embedding')::extensions.vector(768) else null end,
     lease_until=null,attempt=null,expires_at=now()+interval '5 minutes'
     where user_id=p_user_id and cache_key=p_payload->>'key' and version=p_payload->>'version' and attempt=(p_payload->>'attempt')::uuid and lease_until>now();
   if not found then raise exception 'SEARCH_CACHE_STALE' using errcode='40001'; end if; return '{}'::jsonb;
 elsif p_op='snapshot' then
   if jsonb_typeof(p_payload->'results')<>'array' or jsonb_array_length(p_payload->'results')>200 then raise exception 'SEARCH_SNAPSHOT_BOUND' using errcode='22023'; end if;
   insert into private.search_sessions(user_id,context,version,results,info) values(p_user_id,p_payload->>'context',p_payload->>'version',p_payload->'results',p_payload->'info') returning * into v_session;
   return jsonb_build_object('id',v_session.id,'expires',floor(extract(epoch from v_session.expires_at)*1000));
 elsif p_op='page' then
   select * into v_session from private.search_sessions where id=(p_payload->>'session')::uuid and user_id=p_user_id and context=p_payload->>'context' and version=p_payload->>'version' and expires_at>now();
   if not found then raise exception 'SEARCH_CURSOR_EXPIRED' using errcode='P0002'; end if;
   v_offset:=(p_payload->>'offset')::integer; v_size:=(p_payload->>'limit')::integer;
   if v_offset<0 or v_offset>200 or v_size<1 or v_size>50 then raise exception 'SEARCH_PAGE_BOUND' using errcode='22023'; end if;
   -- A fixed result window, re-authorized on every page. Edits/deletions disappear; no re-ranking.
   select coalesce(jsonb_agg(x.result-'snapshotUpdatedAt' order by x.ordinal),'[]') into v_results
   from jsonb_array_elements(v_session.results) with ordinality x(result,ordinal)
   where x.ordinal>v_offset and x.ordinal<=v_offset+v_size and (
     (x.result->>'kind'='item' and exists(select 1 from public.items i where i.id=(x.result->>'itemId')::uuid and i.user_id=p_user_id and i.updated_at::text=x.result->>'snapshotUpdatedAt'))
     or (x.result->>'kind'='action' and exists(select 1 from public.actions a where a.id=(x.result->>'actionId')::uuid and a.user_id=p_user_id and a.updated_at::text=x.result->>'snapshotUpdatedAt'
       and exists(select 1 from public.action_sources s join public.items i on i.id=s.item_id and i.user_id=s.user_id where s.action_id=a.id and s.user_id=p_user_id and s.is_current)
       and not exists(select 1 from jsonb_array_elements(x.result->'sources') z(source) where not exists(
         select 1 from public.items i join public.action_sources s on s.item_id=i.id and s.user_id=i.user_id
         where i.user_id=p_user_id and i.id=(z.source->>'itemId')::uuid and i.updated_at::text=z.source->>'snapshotUpdatedAt' and s.action_id=a.id and s.is_current and s.evidence_text=z.source->>'text'))))) ;
   return jsonb_build_object('results',v_results,'info',v_session.info,'nextOffset',least(v_offset+v_size,jsonb_array_length(v_session.results)),
     'hasMore',v_offset+v_size<jsonb_array_length(v_session.results));
 end if;
 raise exception 'SEARCH_RUNTIME_OP' using errcode='22023';
end $$;

-- A queued job does not authorize provider transmission. No provider calls in triggers/RPCs.
create function private.queue_search_item() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.title is not distinct from old.title and new.content_text is not distinct from old.content_text
   and new.metadata#>'{upload,extraction,pages}' is not distinct from old.metadata#>'{upload,extraction,pages}'
   and new.metadata#>'{drive,tabs}' is not distinct from old.metadata#>'{drive,tabs}' then return new; end if;
 insert into private.search_index_jobs(user_id,item_id,version) values(new.user_id,new.id,'gemini-embedding-2:768:retrieval-v1:chunk-v1')
 on conflict(item_id,version) do update set state='pending',attempt=null,lease_until=null,retry_count=0,retry_after=null,updated_at=now();
 return new;
end $$;
revoke all on function private.queue_search_item() from public,anon,authenticated;
create trigger items_queue_search after insert or update of title,content_text,metadata on public.items for each row execute function private.queue_search_item();

create function public.search_index(p_op text,p_user_id uuid,p_item_id uuid,p_version text,p_payload jsonb default '{}',p_attempt uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_item public.items; v_job private.search_index_jobs; v_id uuid; v_chunk jsonb; v_index integer; v_revision text;
begin
 select * into v_item from public.items where id=p_item_id and user_id=p_user_id for update;
 if not found then raise exception 'SEARCH_ITEM_NOT_FOUND' using errcode='P0002'; end if;
 if p_version is null or length(p_version)>200 then raise exception 'SEARCH_VERSION' using errcode='22023'; end if;
 v_revision:=md5(v_item.title||chr(10)||coalesce(v_item.content_text,'')||chr(10)||coalesce(v_item.metadata#>'{upload,extraction,pages}','null'::jsonb)::text||coalesce(v_item.metadata#>'{drive,tabs}','null'::jsonb)::text);
 insert into private.search_index_jobs(user_id,item_id,version) values(p_user_id,p_item_id,p_version) on conflict do nothing;
 select * into v_job from private.search_index_jobs where item_id=p_item_id and user_id=p_user_id and version=p_version for update;
 if p_op='read' then
   return jsonb_build_object('state',v_job.state,'nextChunk',v_job.next_chunk,'chunkCount',v_job.chunk_count,'semantic',v_job.semantic,'retryAfter',v_job.retry_after);
 elsif p_op='reset_retry' then
   if v_job.lease_until>now() then raise exception 'SEARCH_BUSY' using errcode='55P03'; end if;
   update private.search_index_jobs set retry_count=0,retry_after=null,state='pending',updated_at=now() where item_id=p_item_id and version=p_version; return '{}'::jsonb;
 elsif p_op='claim' then
   if v_job.lease_until>now() then raise exception 'SEARCH_BUSY' using errcode='55P03'; end if;
   if v_job.retry_after>now() or v_job.retry_count>=3 then return jsonb_build_object('state','failed','retryAfter',v_job.retry_after); end if;
   if v_item.updated_at<>(p_payload->>'snapshot')::timestamptz then raise exception 'SEARCH_STALE_INPUT' using errcode='40001'; end if;
   if p_payload->>'fingerprint' !~ '^[a-f0-9]{64}$' or (p_payload->>'chunkCount')::integer not between 0 and 128 then raise exception 'SEARCH_INDEX_BOUND' using errcode='22023'; end if;
   if v_job.state='complete' and v_job.fingerprint=p_payload->>'fingerprint' and v_job.semantic=coalesce((p_payload->>'semantic')::boolean,false) then return jsonb_build_object('state','complete','reused',true); end if;
   v_id:=gen_random_uuid();
   update private.search_index_jobs set state='running',fingerprint=p_payload->>'fingerprint',snapshot_updated_at=v_item.updated_at,text_revision=v_revision,
     chunk_count=(p_payload->>'chunkCount')::integer,next_chunk=case when v_job.fingerprint=p_payload->>'fingerprint' and v_job.semantic=coalesce((p_payload->>'semantic')::boolean,false) then v_job.next_chunk else 0 end,
     semantic=coalesce((p_payload->>'semantic')::boolean,false),attempt=v_id,lease_until=now()+interval '45 seconds',updated_at=now()
     where item_id=p_item_id and version=p_version returning * into v_job;
   return jsonb_build_object('state','claimed','attempt',v_id,'nextChunk',v_job.next_chunk);
 elsif p_op='skip' then
   if v_job.lease_until>now() then raise exception 'SEARCH_BUSY' using errcode='55P03'; end if;
   update private.search_index_jobs set state='skipped_limit',error_code='TEXT_OR_CHUNK_LIMIT',updated_at=now() where item_id=p_item_id and version=p_version; return '{}'::jsonb;
 end if;
 if v_job.attempt is distinct from p_attempt or v_job.lease_until<=now() or v_job.text_revision<>v_revision or v_job.snapshot_updated_at<>v_item.updated_at then raise exception 'SEARCH_INDEX_STALE' using errcode='40001'; end if;
 if p_op='write' then
   v_chunk:=p_payload->'chunk'; v_index:=(v_chunk->>'chunkIndex')::integer;
   if v_index<>v_job.next_chunk or v_index>=v_job.chunk_count or length(v_chunk->>'content')>1200 or length(v_chunk->>'content')=0
     or v_chunk->'metadata'->>'field'<>'content_text' or (v_chunk->'metadata'->>'startChar')::integer<0
     or (v_chunk->'metadata'->>'endChar')::integer-(v_chunk->'metadata'->>'startChar')::integer<>length(v_chunk->>'content')
     or substring(v_item.content_text from (v_chunk->'metadata'->>'startChar')::integer+1 for length(v_chunk->>'content')) is distinct from v_chunk->>'content'
     or (v_job.semantic and p_payload->>'embedding' is null) then raise exception 'SEARCH_CHUNK_INVALID' using errcode='22023'; end if;
   insert into public.search_chunks(user_id,item_id,chunk_index,content,embedding,embedding_model,embedding_version,content_hash,input_hash,index_fingerprint,metadata)
     values(p_user_id,p_item_id,v_index,v_chunk->>'content',case when v_job.semantic then (p_payload->>'embedding')::extensions.vector(768) else null end,
       p_payload->>'model',p_version,v_chunk->>'contentHash',v_chunk->>'inputHash',v_job.fingerprint,v_chunk->'metadata')
     on conflict(item_id,embedding_version,chunk_index) where item_id is not null do update set content=excluded.content,embedding=excluded.embedding,embedding_model=excluded.embedding_model,
       content_hash=excluded.content_hash,input_hash=excluded.input_hash,index_fingerprint=excluded.index_fingerprint,metadata=excluded.metadata;
   update private.search_index_jobs set next_chunk=next_chunk+1,lease_until=now()+interval '45 seconds',updated_at=now() where item_id=p_item_id and version=p_version;
   return '{}'::jsonb;
 elsif p_op='release' then
   update private.search_index_jobs set state='pending',attempt=null,lease_until=null,updated_at=now() where item_id=p_item_id and version=p_version; return '{}'::jsonb;
 elsif p_op='finish' then
   if v_job.next_chunk<>v_job.chunk_count then raise exception 'SEARCH_INCOMPLETE' using errcode='22023'; end if;
   delete from public.search_chunks where user_id=p_user_id and item_id=p_item_id and embedding_version=p_version and chunk_index>=v_job.chunk_count;
   update private.search_index_jobs set state='complete',attempt=null,lease_until=null,retry_count=0,error_code=null,updated_at=now() where item_id=p_item_id and version=p_version; return '{}'::jsonb;
 elsif p_op='fail' then
   update private.search_index_jobs set state='failed',attempt=null,lease_until=null,retry_count=retry_count+1,
     retry_after=now()+make_interval(secs=>greatest(1,least(86400,coalesce((p_payload->>'retryAfter')::integer,60)))),error_code=p_payload->>'code',updated_at=now() where item_id=p_item_id and version=p_version; return '{}'::jsonb;
 end if;
 raise exception 'SEARCH_INDEX_OP' using errcode='22023';
end $$;

create function public.search_candidates(p_user_id uuid,p_version text,p_query text,p_vector extensions.vector,p_filters jsonb,p_intent jsonb) returns jsonb
language sql security invoker set search_path='' as $$
with eligible as (
 select i.*,case when i.source='calendar' then coalesce(((i.metadata->'calendar'->'start'->>'dateTime')::timestamptz at time zone 'Asia/Seoul')::date::text,i.metadata->'calendar'->'start'->>'date',(i.source_created_at at time zone 'Asia/Seoul')::date::text)
   when i.source='drive' then (coalesce(i.source_updated_at,i.source_created_at) at time zone 'Asia/Seoul')::date::text
   else (coalesce(i.source_created_at,i.created_at) at time zone 'Asia/Seoul')::date::text end as search_date
 from public.items i where i.user_id=p_user_id
 and (jsonb_array_length(p_filters->'source')=0 or i.source::text in(select jsonb_array_elements_text(p_filters->'source')))
 and (jsonb_array_length(p_filters->'format')=0 or i.format::text in(select jsonb_array_elements_text(p_filters->'format')))
), filtered as (
 select * from eligible i where (p_filters->>'from' is null or (case when i.source='calendar' then
   case when i.metadata->'calendar'->'end'->>'dateTime' is not null then (i.metadata->'calendar'->'end'->>'dateTime')::timestamptz>((p_filters->>'from')::date::timestamp at time zone 'Asia/Seoul')
     when i.metadata->'calendar'->'end'->>'date' is not null then i.metadata->'calendar'->'end'->>'date'>p_filters->>'from' else i.search_date>=p_filters->>'from' end
   else i.search_date>=p_filters->>'from' end))
 and (p_filters->>'to' is null or i.search_date<=p_filters->>'to')
), tokens as(select t from regexp_split_to_table(lower(p_query),'\s+') t where length(t)>=2 limit 20),
texts as (
 select i.id,c.id as chunk_id,c.chunk_index,c.content,c.metadata,c.embedding,
   case when position(lower(p_query) in lower(i.title))>0 then 5 when position(lower(p_query) in lower(c.content))>0 then 4
   when c.content_tsv @@ websearch_to_tsquery('simple'::regconfig,p_query) then 3
   when exists(select 1 from tokens where position(t in lower(i.title||' '||c.content))>0) then 2 else 0 end as kw
 from filtered i join public.search_chunks c on c.item_id=i.id and c.user_id=p_user_id and c.embedding_version=p_version
 join private.search_index_jobs j on j.item_id=i.id and j.user_id=p_user_id and j.version=p_version and j.state='complete'
 and j.text_revision=md5(i.title||chr(10)||coalesce(i.content_text,'')||chr(10)||coalesce(i.metadata#>'{upload,extraction,pages}','null'::jsonb)::text||coalesce(i.metadata#>'{drive,tabs}','null'::jsonb)::text) and c.index_fingerprint=j.fingerprint
 union all
 -- All collected ITEMs remain keyword-searchable before semantic approval/backfill.
 select i.id,null::uuid,null::integer,coalesce(i.content_text,''),jsonb_build_object('field','content_text','startChar',0,'endChar',length(coalesce(i.content_text,'')),'offsetUnit','unicode_code_point',
 'pages',i.metadata->'upload'->'extraction'->'pages','tabs',i.metadata->'drive'->'tabs'),null::extensions.vector,
 case when position(lower(p_query) in lower(i.title))>0 then 5 when position(lower(p_query) in lower(coalesce(i.content_text,'')))>0 then 4
 when exists(select 1 from tokens where position(t in lower(i.title||' '||coalesce(i.content_text,'')))>0) then 2
 when i.source='gmail' and position(lower(p_query) in lower(coalesce(i.metadata->>'from','')))>0 then 2 else 0 end from filtered i
), kw_items as(select id,max(kw) kw from texts where kw>0 group by id),
kw as(select id,row_number()over(order by kw desc,id) rank from kw_items order by kw desc,id limit 100),
vec_items as(select id,max(1-(embedding operator(extensions.<=>) p_vector)) similarity from texts where p_vector is not null and embedding is not null and extensions.vector_dims(p_vector)=768 group by id),
vec as(select id,row_number()over(order by similarity desc,id) rank from vec_items where similarity>=0.5 order by similarity desc,id limit 100),
ranked as(select coalesce(k.id,v.id) id,coalesce(1.0/(60+k.rank),0)+coalesce(1.0/(60+v.rank),0) score,
 case when k.id is not null and v.id is not null then 'hybrid' when k.id is not null then 'keyword' else 'semantic' end match_type from kw k full join vec v using(id)),
documents as(select jsonb_build_object('kind','item','itemId',i.id,'title',i.title,'source',i.source,'format',i.format,'score',r.score,'matchType',r.match_type,
 'originalUrl',i.original_url,'sourceDate',i.search_date,'sourceDateKind',case i.source when 'calendar' then 'event_start' when 'drive' then 'source_modified' when 'gmail' then 'received' else 'collected' end,
 'calendar',case when i.source='calendar' then jsonb_build_object('start',i.metadata->'calendar'->'start','end',i.metadata->'calendar'->'end','allDay',i.metadata->'calendar'->'allDay','status',i.metadata->'calendar'->'status') else null end,
 'snapshotUpdatedAt',i.updated_at::text,'matchedChunks',(select jsonb_agg(jsonb_build_object('chunkId',z.chunk_id,'chunkIndex',z.chunk_index,'content',z.content,'location',z.metadata)) from
 (select t.* from texts t where t.id=i.id order by t.kw desc,case when t.embedding is not null and p_vector is not null then t.embedding operator(extensions.<=>) p_vector else 2 end,t.chunk_index nulls last limit 3) z)) result,
 r.score,i.search_date,i.id from ranked r join filtered i on i.id=r.id order by r.score desc,i.search_date desc nulls last,i.id limit 200),
action_results as (
 select jsonb_build_object('kind','action','actionId',a.id,'title',a.title,'type',a.action_type,'status',a.status,'deadlineStatus',a.deadline_status,
 'deadlineDate',a.deadline_date,'deadlineAt',a.deadline_at,'requirements',a.requirements,'conditions',a.conditions,'snapshotUpdatedAt',a.updated_at::text,'matchType','action_sql','score',0,
 'sources',(select jsonb_agg(jsonb_build_object('itemId',i.id,'title',i.title,'source',i.source,'format',i.format,'text',s.evidence_text,'location',s.evidence_locator,'originalUrl',i.original_url,'snapshotUpdatedAt',i.updated_at::text) order by s.id)
 from public.action_sources s join eligible i on i.id=s.item_id and i.user_id=s.user_id where s.user_id=p_user_id and s.action_id=a.id and s.is_current)) result,
 a.deadline_date,a.id from public.actions a where a.user_id=p_user_id and a.status='open'
 and (not coalesce((p_intent->>'deadlineOnly')::boolean,false) or a.deadline_status='confirmed')
 and (p_intent->>'from' is null or a.deadline_status='confirmed' and a.deadline_date>=(p_intent->>'from')::date)
 and (p_intent->>'to' is null or a.deadline_status='confirmed' and a.deadline_date<=(p_intent->>'to')::date)
 and (coalesce(p_intent->>'term','')='' or position(p_intent->>'term' in a.title||' '||array_to_string(a.requirements,' '))>0)
 and exists(select 1 from public.action_sources s join eligible i on i.id=s.item_id and i.user_id=s.user_id where s.action_id=a.id and s.user_id=p_user_id and s.is_current
   and (a.deadline_status<>'confirmed' or not coalesce((p_intent->>'deadlineOnly')::boolean,false) or s.id=a.deadline_source_id))
 order by a.deadline_date asc nulls last,a.id limit 200
)
select case when p_intent->>'kind'='actions' then coalesce((select jsonb_agg(result order by deadline_date asc nulls last,id) from action_results),'[]')
 else coalesce((select jsonb_agg(result order by score desc,search_date desc nulls last,id) from documents),'[]') end;
$$;

create function public.search_similar(p_user_id uuid,p_item_id uuid,p_version text,p_limit integer default 5) returns jsonb
language sql security invoker set search_path='' as $$
with source as (
 select c.embedding,c.chunk_index,row_number()over(order by c.chunk_index) rn,count(*)over() n from public.search_chunks c
 join public.items i on i.id=c.item_id and i.user_id=c.user_id join private.search_index_jobs j on j.item_id=i.id and j.user_id=i.user_id and j.version=c.embedding_version
 where c.user_id=p_user_id and c.item_id=p_item_id and c.embedding_version=p_version and c.embedding is not null and j.state='complete' and j.fingerprint=c.index_fingerprint
 and j.text_revision=md5(i.title||chr(10)||coalesce(i.content_text,'')||chr(10)||coalesce(i.metadata#>'{upload,extraction,pages}','null'::jsonb)::text||coalesce(i.metadata#>'{drive,tabs}','null'::jsonb)::text)
), representatives as(select * from source where rn in(1,greatest(1,ceil(n/3.0)::integer),greatest(1,ceil(2*n/3.0)::integer),n)),
matches as(select i.id,i.title,i.source,i.format,i.original_url,max(1-(c.embedding operator(extensions.<=>) s.embedding)) score
 from representatives s join public.search_chunks c on c.user_id=p_user_id and c.item_id<>p_item_id and c.embedding_version=p_version and c.embedding is not null
 join public.items i on i.id=c.item_id and i.user_id=p_user_id join private.search_index_jobs j on j.item_id=i.id and j.user_id=p_user_id and j.version=p_version
 where j.state='complete' and j.fingerprint=c.index_fingerprint and j.text_revision=md5(i.title||chr(10)||coalesce(i.content_text,'')||chr(10)||coalesce(i.metadata#>'{upload,extraction,pages}','null'::jsonb)::text||coalesce(i.metadata#>'{drive,tabs}','null'::jsonb)::text) group by i.id),
top_matches as(select * from matches where score>=0.5 order by score desc,id limit greatest(1,least(p_limit,10)))
select coalesce(jsonb_agg(jsonb_build_object('itemId',id,'title',title,'source',source,'format',format,'originalUrl',original_url,'score',score) order by score desc,id),'[]') from top_matches;
$$;

revoke all on function public.search_runtime(text,uuid,jsonb),public.search_index(text,uuid,uuid,text,jsonb,uuid),
 public.search_candidates(uuid,text,text,extensions.vector,jsonb,jsonb),public.search_similar(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.search_runtime(text,uuid,jsonb),public.search_index(text,uuid,uuid,text,jsonb,uuid),
 public.search_candidates(uuid,text,text,extensions.vector,jsonb,jsonb),public.search_similar(uuid,uuid,text,integer) to service_role;
commit;
