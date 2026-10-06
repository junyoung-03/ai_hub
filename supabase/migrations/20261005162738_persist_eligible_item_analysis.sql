-- Approved FINAL BACKEND GAP FIX: one additive server-only RPC. Preserve existing Gmail RPC.
begin;
create function public.persist_eligible_item_analysis(
  p_user_id uuid, p_item_id uuid, p_content_text text, p_content_hash text,
  p_analysis jsonb, p_model text, p_input_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_candidate jsonb; v_quote jsonb; v_observation jsonb; v_locator jsonb;
  v_key text; v_action_id uuid; v_source_id uuid;
  v_existing public.action_sources%rowtype; v_selected public.action_sources%rowtype;
  v_date date; v_at timestamptz; v_distinct integer; v_matches integer;
  v_unclear boolean; v_had_sources boolean;
  v_created integer := 0; v_reused integer := 0; v_seen uuid[] := '{}'::uuid[];
begin
  if p_user_id is null or p_item_id is null or nullif(btrim(p_model),'') is null
     or p_input_fingerprint is null or p_input_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid analysis request' using errcode='22023';
  end if;
  -- Lock owner before children. NO KEY UPDATE is compatible with FK KEY SHARE locks.
  perform u.id from public.users u where u.id=p_user_id for no key update;
  if not found then raise exception 'ITEM not found' using errcode='P0002'; end if;
  select * into v_item from public.items where id=p_item_id and user_id=p_user_id
    and ((source='gmail' and format='email')
      or (source='drive' and format='document')
      or (source='upload' and format in ('pdf','image')
        and metadata#>>'{upload,extraction,status}'='complete'
        and metadata#>>'{upload,extraction,version}'='upload-text-v1')) for update;
  if not found then raise exception 'ITEM not found' using errcode='P0002'; end if;
  if v_item.content_text is distinct from p_content_text
    or v_item.content_hash is distinct from p_content_hash
    or nullif(btrim(p_content_text),'') is null then
    raise exception 'ITEM content changed' using errcode='22023';
  end if;
  if p_analysis is null or p_analysis->>'schemaVersion' is distinct from '0.2'
     or jsonb_typeof(p_analysis->'classification') is distinct from 'object'
     or jsonb_typeof(p_analysis->'actions') is distinct from 'array'
     or jsonb_typeof(p_analysis->'eventObservations') is distinct from 'array'
     or nullif(btrim(p_analysis#>>'{classification,primaryTopic}'),'') is null then
    raise exception 'Invalid analysis result' using errcode='22023';
  end if;
  if jsonb_array_length(p_analysis->'actions')>10
    or jsonb_array_length(p_analysis->'eventObservations')>10 then
    raise exception 'Too many candidates' using errcode='22023';
  end if;
  -- Exact repeat is a no-op, including updated_at and historical Evidence rows.
  if v_item.metadata#>>'{aiAnalysis,schemaVersion}'='0.2'
    and v_item.metadata#>>'{aiAnalysis,model}'=p_model
    and v_item.metadata#>>'{aiAnalysis,inputFingerprint}'=p_input_fingerprint
    and v_item.metadata#>'{aiAnalysis,result}'=p_analysis then
    return jsonb_build_object('created_count',0,'reused_count',jsonb_array_length(p_analysis->'actions'),
      'action_count',jsonb_array_length(p_analysis->'actions'),'cached',true);
  end if;
  -- Reject non-grounded/invalid offsets even for trusted server RPC requests.
  for v_candidate in select value from jsonb_array_elements(p_analysis->'actions') loop
    if nullif(btrim(v_candidate->>'title'),'') is null
      or jsonb_typeof(v_candidate->'evidence') is distinct from 'array' then
      raise exception 'Invalid action' using errcode='22023';
    end if;
    if jsonb_array_length(v_candidate->'evidence') not between 1 and 5 then
      raise exception 'Invalid action evidence' using errcode='22023';
    end if;
  end loop;
  for v_quote in
    select e.value from jsonb_array_elements(p_analysis->'actions') a,
      lateral jsonb_array_elements(a.value->'evidence') e
    union all
    select a.value#>'{startObservation,evidence}' from jsonb_array_elements(p_analysis->'actions') a
      where a.value#>>'{startObservation,status}' <> 'none'
    union all
    select a.value#>'{deadlineObservation,evidence}' from jsonb_array_elements(p_analysis->'actions') a
      where a.value#>>'{deadlineObservation,status}' <> 'none'
    union all
    select e.value->'evidence' from jsonb_array_elements(p_analysis->'eventObservations') e
  loop
    if nullif(btrim(v_quote->>'text'),'') is null
      or v_quote#>>'{locator,kind}' is distinct from 'text_span'
      or v_quote#>>'{locator,field}' is distinct from 'content_text'
      or v_quote#>>'{locator,startChar}' is null or v_quote#>>'{locator,endChar}' is null
      or (v_quote#>>'{locator,startChar}')::integer<0
      or (v_quote#>>'{locator,endChar}')::integer<=(v_quote#>>'{locator,startChar}')::integer
      or substring(p_content_text from (v_quote#>>'{locator,startChar}')::integer+1
        for (v_quote#>>'{locator,endChar}')::integer-(v_quote#>>'{locator,startChar}')::integer)
        is distinct from v_quote->>'text' then
      raise exception 'Evidence or locator is absent from ITEM' using errcode='22023';
    end if;
  end loop;
  for v_observation in
    select a.value->'startObservation' from jsonb_array_elements(p_analysis->'actions') a
    union all select a.value->'deadlineObservation' from jsonb_array_elements(p_analysis->'actions') a
    union all select value from jsonb_array_elements(p_analysis->'eventObservations')
  loop
    if v_observation->>'status' is null or v_observation->>'status' not in ('confirmed','needs_review','none')
      or (v_observation->>'status'='confirmed' and v_observation->>'date' is null)
      or (v_observation->>'status'<>'confirmed' and (v_observation->>'date' is not null or v_observation->>'datetime' is not null))
      or (v_observation->>'status'<>'none' and (nullif(btrim(v_observation->>'rawText'),'') is null
        or position((v_observation->>'rawText') in (v_observation#>>'{evidence,text}'))=0)) then
      raise exception 'Invalid date observation' using errcode='22023';
    end if;
  end loop;

  perform public.upsert_ai_classification(p_user_id,p_item_id,p_analysis#>>'{classification,primaryTopic}',
    (p_analysis#>>'{classification,documentType}')::public.document_type,
    array(select jsonb_array_elements_text(p_analysis#>'{classification,tags}')));
  -- Owner-wide transaction lock serializes managed Action matching across requests.
  -- It does not replace existing actual-update Evidence parent locks.
  perform a.id from public.actions a where a.user_id=p_user_id and exists (
    select 1 from public.action_sources s where s.action_id=a.id and s.user_id=p_user_id
      and s.item_id=p_item_id and s.is_current) order by a.id for update;
  select exists(select 1 from public.action_sources s where s.user_id=p_user_id
    and s.item_id=p_item_id and s.is_current) into v_had_sources;

  for v_candidate in select value from jsonb_array_elements(p_analysis->'actions') loop
    v_key:=lower(regexp_replace(btrim(v_candidate->>'title'),'\s+',' ','g')) || ':' || (v_candidate->>'actionType');
    select count(*) into v_matches from public.action_sources s join public.actions a
      on a.id=s.action_id and a.user_id=s.user_id
      where s.user_id=p_user_id and s.item_id=p_item_id and s.is_current
        and (s.evidence_locator->>'analysisKey'=v_key or (s.evidence_text=v_candidate#>>'{evidence,0,text}'
          and a.action_type::text=v_candidate->>'actionType'));
    if v_matches>1 then raise exception 'Ambiguous action match' using errcode='22023'; end if;
    select s.* into v_existing from public.action_sources s join public.actions a
      on a.id=s.action_id and a.user_id=s.user_id
      where s.user_id=p_user_id and s.item_id=p_item_id and s.is_current
        and (s.evidence_locator->>'analysisKey'=v_key or (s.evidence_text=v_candidate#>>'{evidence,0,text}'
          and a.action_type::text=v_candidate->>'actionType')) order by s.id limit 1;
    if found then
      v_action_id:=v_existing.action_id;
      if v_action_id=any(v_seen) then raise exception 'Ambiguous action match' using errcode='22023'; end if;
      v_reused:=v_reused+1;
    else
      if v_had_sources then raise exception 'Action matching requires review' using errcode='22023'; end if;
      insert into public.actions(user_id,title,action_type,start_date,start_at,requirements,conditions)
        values(p_user_id,v_candidate->>'title',(v_candidate->>'actionType')::public.action_type,
          (v_candidate#>>'{startObservation,date}')::date,(v_candidate#>>'{startObservation,datetime}')::timestamptz,
          array(select jsonb_array_elements_text(v_candidate->'requirements')),
          array(select jsonb_array_elements_text(v_candidate->'conditions'))) returning id into v_action_id;
      v_created:=v_created+1;
    end if;
    v_seen:=array_append(v_seen,v_action_id);
    if exists(select 1 from public.actions where id=v_action_id and user_id=p_user_id
      and deadline_resolution_reason is not null) then
      raise exception 'Resolved deadline requires review' using errcode='22023';
    end if;
    v_date:=(v_candidate#>>'{deadlineObservation,date}')::date;
    v_at:=(v_candidate#>>'{deadlineObservation,datetime}')::timestamptz;
    -- First quote remains directly accessible to current Detail UI; all quotes are preserved.
    v_locator:=(v_candidate#>'{evidence,0,locator}') || jsonb_build_object('analysisKey',v_key,
      'schemaVersion','0.2','evidence',v_candidate->'evidence','startObservation',v_candidate->'startObservation',
      'deadlineObservation',v_candidate->'deadlineObservation');
    if v_existing.action_id=v_action_id and v_existing.evidence_locator=v_locator
      and v_existing.evidence_text=v_candidate#>>'{evidence,0,text}'
      and v_existing.observed_deadline_date is not distinct from v_date
      and v_existing.observed_deadline_at is not distinct from v_at then
      v_source_id:=v_existing.id;
    else
      update public.action_sources set is_current=false where action_id=v_action_id
        and item_id=p_item_id and user_id=p_user_id and is_current;
      insert into public.action_sources(user_id,action_id,item_id,evidence_text,evidence_locator,
        observed_deadline_date,observed_deadline_at)
        values(p_user_id,v_action_id,p_item_id,v_candidate#>>'{evidence,0,text}',v_locator,v_date,v_at)
        returning id into v_source_id;
    end if;
    select count(*) into v_distinct from (select distinct observed_deadline_date,observed_deadline_at
      from public.action_sources where action_id=v_action_id and user_id=p_user_id
        and is_current and observed_deadline_date is not null) d;
    select coalesce(bool_or(evidence_locator#>>'{deadlineObservation,status}'='needs_review'),false) into v_unclear
      from public.action_sources where action_id=v_action_id and user_id=p_user_id and is_current;
    select * into v_selected from public.action_sources where action_id=v_action_id and user_id=p_user_id
      and is_current and observed_deadline_date is not null order by id limit 1;
    update public.actions set
      deadline_status=(case when v_distinct>1 or v_unclear then 'needs_review' when v_distinct=1 then 'confirmed' else 'none' end)::public.deadline_status,
      deadline_date=case when v_distinct=1 and not v_unclear then v_selected.observed_deadline_date end,
      deadline_at=case when v_distinct=1 and not v_unclear then v_selected.observed_deadline_at end,
      deadline_source_id=case when v_distinct=1 and not v_unclear then v_selected.id end,
      deadline_resolution_reason=null,deadline_resolved_at=null
      where id=v_action_id and user_id=p_user_id;
    -- Reused Action title/start/requirements/completion fields are intentionally preserved.
    v_existing:=null;
  end loop;
  if exists(select 1 from public.action_sources where user_id=p_user_id and item_id=p_item_id and is_current
    and evidence_locator ? 'analysisKey' and not (action_id=any(v_seen))) then
    raise exception 'Removed action requires review' using errcode='22023';
  end if;
  update public.items set processing_status='indexing',processing_error=null,
    metadata=metadata || jsonb_build_object('aiAnalysis',jsonb_build_object('schemaVersion','0.2',
      'model',p_model,'inputFingerprint',p_input_fingerprint,'analyzedAt',now(),'result',p_analysis))
    where id=p_item_id and user_id=p_user_id;
  return jsonb_build_object('created_count',v_created,'reused_count',v_reused,
    'action_count',jsonb_array_length(p_analysis->'actions'),'cached',false);
end;
$$;
revoke all on function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text) to service_role;
comment on function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text) is
  'Phase 6A v0.2 atomic AI-only persistence. Server schema/semantic validation is mandatory before calling.';
commit;

