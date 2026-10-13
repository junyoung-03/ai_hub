-- Local rehearsal only. Remote application requires a separate user approval.
begin;

-- Deterministic normalization of stored classification only; no source text or AI calls.
create function public.normalize_ai_topic(p_topic text,p_type public.document_type,p_tags text[]) returns text
language sql immutable security invoker set search_path='' as $$
 with signals as (select
  p_type='contract' or exists(select 1 from unnest(p_tags) t where btrim(t) ~ '^(계약|계약서|계약 갱신|동의서)$') as contract,
  p_type='billing' or exists(select 1 from unnest(p_tags) t where btrim(t) ~ '^(청구|청구서|납부|카드 명세서|카드 대금|결제 내역)$') as billing,
  p_type='schedule' or exists(select 1 from unnest(p_tags) t where btrim(t) ~ '^(시험|면접|세미나|행사|설명회|시험 일정|면접 일정|세미나 일정|행사 일정)$') as event)
 select case when p_topic not in ('일반','일반자료','general') or p_topic is null then p_topic
  when coalesce(contract::int,0)+coalesce(billing::int,0)+coalesce(event::int,0)<>1 then p_topic
  when contract then '계약·행정' when billing then '결제·금융' when event then '일정·행사' else p_topic end from signals;
$$;
revoke all on function public.normalize_ai_topic(text,public.document_type,text[]) from public,anon,authenticated,service_role;
grant execute on function public.normalize_ai_topic(text,public.document_type,text[]) to authenticated,service_role;

create function private.normalize_stored_classification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 -- Any user override freezes normalization; even an empty user_tags is an override.
 if tg_op='INSERT' and exists(select 1 from public.classifications c where c.item_id=new.item_id and c.user_id=new.user_id
  and (c.user_primary_topic is not null or c.user_document_type is not null or c.user_tags is not null)) then return new; end if;
 if new.user_primary_topic is null and new.user_document_type is null and new.user_tags is null then
  new.ai_primary_topic:=public.normalize_ai_topic(new.ai_primary_topic,new.ai_document_type,new.ai_tags);
 end if;
 return new;
end $$;
revoke all on function private.normalize_stored_classification() from public,anon,authenticated,service_role;
create trigger classification_topic_normalized before insert or update on public.classifications
 for each row execute function private.normalize_stored_classification();

-- Existing important classifications protect mail even if the model omitted a signal.
create function public.gmail_important_notice(public.items) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.classifications c where c.item_id=($1).id and c.user_id=($1).user_id and
  (c.ai_document_type in ('billing','contract') or c.user_document_type in ('billing','contract')
   or concat_ws(' ',c.ai_primary_topic,c.user_primary_topic,array_to_string(c.ai_tags,' '),array_to_string(c.user_tags,' ')) ~ '(보안|계정|서비스[[:space:]]*장애)'
   or exists(select 1 from unnest(c.ai_tags || coalesce(c.user_tags,'{}'::text[])) t where btrim(t) in ('결제','청구','청구서','납부','계약','계약서'))));
$$;
revoke all on function public.gmail_important_notice(public.items) from public,anon,authenticated,service_role;
grant execute on function public.gmail_important_notice(public.items) to authenticated,service_role;

-- Keep existing RLS, evidence, override and search implementations; patch source boundaries.
do $patch$
declare def text; old text;
begin
 def:=replace(pg_get_functiondef('public.item_is_visible(public.items)'::regprocedure),E'\r\n',E'\n');
 old:=E'begin\n select * into n';
 if position(old in def)=0 then raise exception 'Unexpected visibility contract'; end if;
 def:=replace(def,old,E'begin\n -- GMAIL_ONLY_NOISE_V1\n if i.source::text<>''gmail'' then return true; end if;\n select * into n');
 old:='if i.source::text=''calendar'' then return true; end if;';
 if position(old in def)=0 then raise exception 'Unexpected important protection contract'; end if;
 execute replace(def,old,'if public.gmail_important_notice(i) then return true; end if;');

 def:=replace(pg_get_functiondef('public.item_noise_state(public.items)'::regprocedure),E'\r\n',E'\n');
 old:=E'begin\n select * into n';
 if position(old in def)=0 then raise exception 'Unexpected state contract'; end if;
 def:=replace(def,old,E'begin\n if i.source::text<>''gmail'' then return jsonb_build_object(''aiVerdict'',null,''userOverride'',null,''effectiveVisibility'',''SHOW'',''protectionState'',jsonb_build_array(''non_gmail'')); end if;\n select * into n');
 old:='visible:=public.item_is_visible(i);';
 execute replace(def,old,'if public.gmail_important_notice(i) then reasons:=array_append(reasons,''important_classification''); end if; '||old);

 def:=pg_get_functiondef('public.set_noise_override(uuid,text)'::regprocedure);
 old:='if not found then raise exception ''ITEM not found'' using errcode=''P0002''; end if;';
 if position(old in def)=0 then raise exception 'Unexpected override contract'; end if;
 execute replace(def,old,old||E'\n if i.source::text<>''gmail'' then raise exception ''Gmail noise override only'' using errcode=''22023''; end if;');

 def:=pg_get_functiondef('private.persist_noise_analysis(uuid,uuid,text,text,jsonb,text,text,boolean)'::regprocedure);
 old:='if not found then raise exception ''ITEM not found'' using errcode=''P0002''; end if;';
 if position(old in def)=0 then raise exception 'Unexpected persistence contract'; end if;
 -- Older callers can submit v0.3 for a non-Gmail ITEM: retain analysis, discard noise.
 execute replace(def,old,old||$non_gmail$
 if i.source::text<>'gmail' then
  legacy:=jsonb_set(p_analysis-'noiseAssessment','{schemaVersion}','"0.2"'::jsonb);
  return private.persist_eligible_item_analysis_v02(p_user_id,p_item_id,p_content_text,p_content_hash,legacy,p_model,
   encode(sha256(convert_to('{"schemaVersion":"0.2","model":'||to_json(p_model)::text||',"contentText":'||to_json(p_content_text)::text||'}','UTF8')),'hex'));
 end if;
$non_gmail$);

 def:=pg_get_functiondef('public.finish_gmail_analysis_job(uuid,uuid,uuid,jsonb,text,text,text,integer)'::regprocedure);
 old:='if p_analysis->>''schemaVersion'' is distinct from ''0.2'' then raise exception ''Worker schema must remain 0.2''; end if;';
 if position(old in def)=0 then raise exception 'Unexpected worker schema contract'; end if;
 execute replace(def,old,'if coalesce(p_analysis->>''schemaVersion'','''') not in (''0.2'',''0.3'') then raise exception ''Invalid worker schema''; end if;');
end $patch$;

-- Only AI columns are normalized. Source/metadata/Action/Evidence and user_* remain intact.
with normalized as (update public.classifications c set ai_primary_topic=public.normalize_ai_topic(c.ai_primary_topic,c.ai_document_type,c.ai_tags)
 where c.user_primary_topic is null and c.user_document_type is null and c.user_tags is null
 and c.ai_primary_topic is distinct from public.normalize_ai_topic(c.ai_primary_topic,c.ai_document_type,c.ai_tags)
 returning c.user_id)
delete from private.search_sessions where user_id in (select user_id from normalized);

-- Older broad-source DB policy must not pass the new app's readiness gate.
create function public.gmail_promotional_ready() returns boolean
language sql stable security invoker set search_path='' as $$
 select public.promotional_noise_ready()
 and position('GMAIL_ONLY_NOISE_V1' in pg_get_functiondef('public.item_is_visible(public.items)'::regprocedure))>0
 and exists(select 1 from pg_trigger where tgrelid='public.classifications'::regclass and tgname='classification_topic_normalized' and not tgisinternal);
$$;
revoke all on function public.gmail_promotional_ready() from public,anon,authenticated,service_role;
grant execute on function public.gmail_promotional_ready() to authenticated,service_role;
notify pgrst,'reload schema';
commit;
