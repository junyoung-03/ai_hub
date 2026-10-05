-- Search-3: exact-title priority and deterministic keyword date ties. No provider/data changes.
begin;
create or replace function public.search_candidates(p_user_id uuid,p_version text,p_query text,p_vector extensions.vector,p_filters jsonb,p_intent jsonb) returns jsonb
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
   case when lower(i.title)=lower(p_query) then 6 when position(lower(p_query) in lower(i.title))>0 then 5 when position(lower(p_query) in lower(c.content))>0 then 4
   when c.content_tsv @@ websearch_to_tsquery('simple'::regconfig,p_query) then 3
   when exists(select 1 from tokens where position(t in lower(i.title||' '||c.content))>0) then 2 else 0 end as kw
 from filtered i join public.search_chunks c on c.item_id=i.id and c.user_id=p_user_id and c.embedding_version=p_version
 join private.search_index_jobs j on j.item_id=i.id and j.user_id=p_user_id and j.version=p_version and j.state='complete'
 and j.text_revision=md5(i.title||chr(10)||coalesce(i.content_text,'')||chr(10)||coalesce(i.metadata#>'{upload,extraction,pages}','null'::jsonb)::text||coalesce(i.metadata#>'{drive,tabs}','null'::jsonb)::text) and c.index_fingerprint=j.fingerprint
 union all
 -- All collected ITEMs remain keyword-searchable before semantic approval/backfill.
 select i.id,null::uuid,null::integer,coalesce(i.content_text,''),jsonb_build_object('field','content_text','startChar',0,'endChar',length(coalesce(i.content_text,'')),'offsetUnit','unicode_code_point',
 'pages',i.metadata->'upload'->'extraction'->'pages','tabs',i.metadata->'drive'->'tabs'),null::extensions.vector,
 case when lower(i.title)=lower(p_query) then 6 when position(lower(p_query) in lower(i.title))>0 then 5 when position(lower(p_query) in lower(coalesce(i.content_text,'')))>0 then 4
 when exists(select 1 from tokens where position(t in lower(i.title||' '||coalesce(i.content_text,'')))>0) then 2
 when i.source='gmail' and position(lower(p_query) in lower(coalesce(i.metadata->>'from','')))>0 then 2 else 0 end from filtered i
), kw_items as(select id,max(kw) kw from texts where kw>0 group by id),
kw as(select k.id,row_number()over(order by k.kw desc,i.search_date desc nulls last,k.id) rank from kw_items k join filtered i on i.id=k.id order by k.kw desc,i.search_date desc nulls last,k.id limit 100),
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
commit;
