-- Calendar-2 DRAFT ONLY. No ai-hub-dev/production application authorized.
-- Function only; no table/column/index/RLS or existing Migration changes.
begin;
create function public.persist_calendar_item(
  p_user_id uuid, p_connection_id uuid, p_event_id text,
  p_title text, p_original_url text, p_content_text text, p_content_hash text,
  p_source_created_at timestamptz, p_source_updated_at timestamptz,
  p_calendar_metadata jsonb, p_expected_item_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_connection public.connections%rowtype; v_item public.items%rowtype; v_id uuid;
  v_status text; v_meta jsonb; v_key text; v_date jsonb; v_canonical text;
  v_start text; v_end text; v_has_item boolean;
begin
  -- Same lock order as disconnect: connection -> ITEM. No Google HTTP under lock.
  select * into v_connection from public.connections where id=p_connection_id and user_id=p_user_id
    and provider='google' and status='connected' for update;
  if not found then raise exception 'Connection unavailable' using errcode='22023'; end if;
  if coalesce('https://www.googleapis.com/auth/calendar.events.owned.readonly'=any(v_connection.scopes),false) is not true
    or not exists(select 1 from private.google_connection_tokens where connection_id=p_connection_id and user_id=p_user_id) then
    raise exception 'Calendar authorization required' using errcode='22023';
  end if;
  if p_event_id is null or length(p_event_id)>1024 or p_event_id !~ '^[A-Za-z0-9_-]+$'
    or jsonb_typeof(p_calendar_metadata) is distinct from 'object'
    or p_calendar_metadata->>'eventId' is distinct from p_event_id
    or p_calendar_metadata->>'calendarId' is distinct from 'primary'
    or p_calendar_metadata->>'eventType' is distinct from 'default'
    or p_calendar_metadata->>'extractionVersion' is distinct from 'calendar-text-v1'
    or p_title is null or p_content_text is null
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or char_length(p_content_text)>100000 or octet_length(p_content_text)>400000
    or p_content_hash is distinct from encode(sha256(convert_to(p_content_text,'UTF8')),'hex') then
    raise exception 'Invalid Calendar input' using errcode='22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_calendar_metadata))<>20
    or exists(select 1 from jsonb_object_keys(p_calendar_metadata) k where k not in (
      'eventId','calendarId','etag','updated','created','status','eventType','summary','description','location','htmlLink',
      'start','end','allDay','eventTimezone','calendarTimezone','endTimeUnspecified','recurringEventId','originalStartTime','extractionVersion')) then
    raise exception 'Unsupported Calendar metadata' using errcode='22023';
  end if;
  v_status:=p_calendar_metadata->>'status';
  if v_status is null or v_status not in ('confirmed','tentative','cancelled')
    or jsonb_typeof(p_calendar_metadata->'summary') is distinct from 'string'
    or jsonb_typeof(p_calendar_metadata->'description') is distinct from 'string'
    or jsonb_typeof(p_calendar_metadata->'location') is distinct from 'string'
    or jsonb_typeof(p_calendar_metadata->'endTimeUnspecified') is distinct from 'boolean'
    or p_calendar_metadata->>'summary' is distinct from p_title
    or p_calendar_metadata->>'htmlLink' is distinct from p_original_url
    or (p_original_url is not null and p_original_url !~ '^https://(www[.]google[.]com/calendar/|calendar[.]google[.]com/)')
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_calendar_metadata->>'calendarTimezone') then
    raise exception 'Invalid Calendar fields' using errcode='22023';
  end if;
  foreach v_key in array array['etag','updated','created','eventTimezone','recurringEventId'] loop
    if jsonb_typeof(p_calendar_metadata->v_key) not in ('string','null') then
      raise exception 'Invalid optional Calendar field' using errcode='22023';
    end if;
  end loop;
  if p_calendar_metadata->>'etag' is not null and (length(p_calendar_metadata->>'etag')<1 or length(p_calendar_metadata->>'etag')>1024)
    or p_calendar_metadata->>'recurringEventId' is not null and (length(p_calendar_metadata->>'recurringEventId')>1024 or p_calendar_metadata->>'recurringEventId' !~ '^[A-Za-z0-9_-]+$')
    or p_calendar_metadata->>'eventTimezone' is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_calendar_metadata->>'eventTimezone') then
    raise exception 'Invalid Calendar identity metadata' using errcode='22023';
  end if;
  foreach v_key in array array['created','updated'] loop
    if p_calendar_metadata->>v_key is not null and p_calendar_metadata->>v_key !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Invalid source date' using errcode='22023';
    end if;
  end loop;
  if (p_calendar_metadata->>'created')::timestamptz is distinct from p_source_created_at
    or (p_calendar_metadata->>'updated')::timestamptz is distinct from p_source_updated_at then
    raise exception 'Source date mismatch' using errcode='22023';
  end if;
  foreach v_key in array array['start','end','originalStartTime'] loop
    v_date:=p_calendar_metadata->v_key;
    if v_date<>'null'::jsonb then
      if jsonb_typeof(v_date) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(v_date) k where k not in ('date','dateTime','timeZone'))
        or (v_date ? 'date')=(v_date ? 'dateTime')
        or (v_date ? 'timeZone' and not exists(select 1 from pg_catalog.pg_timezone_names where name=v_date->>'timeZone')) then
        raise exception 'Invalid Calendar date structure' using errcode='22023';
      end if;
      if v_date ? 'date' then
        if jsonb_typeof(v_date->'date') is distinct from 'string' or v_date->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
          or ((v_date->>'date')::date)::text is distinct from v_date->>'date' then
          raise exception 'Invalid all-day date' using errcode='22023';
        end if;
      else
        if jsonb_typeof(v_date->'dateTime') is distinct from 'string'
          or v_date->>'dateTime' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
          raise exception 'Invalid event timestamp' using errcode='22023';
        end if;
        perform (v_date->>'dateTime')::timestamptz;
      end if;
    end if;
  end loop;
  if (p_calendar_metadata->>'recurringEventId' is null) is distinct from (p_calendar_metadata->'originalStartTime'='null'::jsonb) then
    raise exception 'Invalid occurrence relation' using errcode='22023';
  end if;
  if v_status<>'cancelled' then
    if p_calendar_metadata->'start'='null'::jsonb or p_calendar_metadata->'end'='null'::jsonb
      or (p_calendar_metadata->'start' ? 'date') is distinct from (p_calendar_metadata->'end' ? 'date')
      or jsonb_typeof(p_calendar_metadata->'allDay') is distinct from 'boolean'
      or (p_calendar_metadata->>'allDay')::boolean is distinct from (p_calendar_metadata->'start' ? 'date') then
      raise exception 'Invalid event dates' using errcode='22023';
    end if;
    if p_calendar_metadata->'start' ? 'date' then
      if (p_calendar_metadata#>>'{end,date}')::date <= (p_calendar_metadata#>>'{start,date}')::date then
        raise exception 'Invalid exclusive end' using errcode='22023';
      end if;
    elsif (p_calendar_metadata#>>'{end,dateTime}')::timestamptz <= (p_calendar_metadata#>>'{start,dateTime}')::timestamptz then
      raise exception 'Invalid exclusive end' using errcode='22023';
    end if;
    v_start:=coalesce(p_calendar_metadata#>>'{start,date}',p_calendar_metadata#>>'{start,dateTime}')
      ||coalesce(' ['||(p_calendar_metadata#>>'{start,timeZone}')||']','');
    v_end:=coalesce(p_calendar_metadata#>>'{end,date}',p_calendar_metadata#>>'{end,dateTime}')
      ||coalesce(' ['||(p_calendar_metadata#>>'{end,timeZone}')||']','');
    v_canonical:=(p_calendar_metadata->>'summary')||E'\n\n'||(p_calendar_metadata->>'description')||E'\n\n'
      ||(p_calendar_metadata->>'location')||E'\n\nEvent start: '||v_start||E'\n\nEvent end (exclusive): '||v_end
      ||E'\n\nCalendar timezone: '||(p_calendar_metadata->>'calendarTimezone');
    if v_canonical is distinct from p_content_text then raise exception 'Canonical text mismatch' using errcode='22023'; end if;
  end if;
  select * into v_item from public.items where user_id=p_user_id and connection_id=p_connection_id
    and source='calendar' and external_container_id='primary' and external_id=p_event_id for update;
  v_has_item:=found;
  if v_has_item then
    if p_expected_item_updated_at is null or v_item.updated_at is distinct from p_expected_item_updated_at then
      raise exception 'ITEM changed during collection' using errcode='40001';
    end if;
    if v_item.metadata->'calendar'=p_calendar_metadata and (v_status='cancelled' or v_item.content_hash=p_content_hash) then
      return jsonb_build_object('item_id',v_item.id,'outcome','reused');
    end if;
    if v_status='cancelled' and v_item.metadata#>>'{calendar,status}'='cancelled'
      and v_item.metadata#>>'{calendar,etag}' is not distinct from p_calendar_metadata->>'etag'
      and v_item.source_updated_at is not distinct from p_source_updated_at then
      return jsonb_build_object('item_id',v_item.id,'outcome','reused');
    end if;
    -- ETags are opaque; they do not prove ordering. Missing/equal source versions cannot overwrite.
    if p_source_updated_at is null or v_item.source_updated_at is null or p_source_updated_at<=v_item.source_updated_at then
      raise exception 'Stale or unordered source snapshot' using errcode='40001';
    end if;
    if v_status='cancelled' then
      -- Keep last normal text/dates/URL. Only authoritative cancellation/version fields change.
      v_meta:=(v_item.metadata->'calendar')||jsonb_build_object('status','cancelled',
        'updated',p_calendar_metadata->'updated','etag',p_calendar_metadata->'etag');
      update public.items set metadata=metadata||jsonb_build_object('calendar',v_meta),
        source_updated_at=p_source_updated_at where id=v_item.id and user_id=p_user_id;
    else
      update public.items set title=p_title,original_url=p_original_url,content_text=p_content_text,content_hash=p_content_hash,
        source_created_at=p_source_created_at,source_updated_at=p_source_updated_at,
        metadata=metadata||jsonb_build_object('calendar',p_calendar_metadata) where id=v_item.id and user_id=p_user_id;
    end if;
    return jsonb_build_object('item_id',v_item.id,'outcome','updated');
  end if;
  if p_expected_item_updated_at is not null then raise exception 'Expected ITEM missing' using errcode='40001'; end if;
  if v_status='cancelled' then return jsonb_build_object('outcome','skipped'); end if;
  insert into public.items(user_id,connection_id,source,format,external_id,external_container_id,title,original_url,
    content_text,content_hash,source_created_at,source_updated_at,mime_type,storage_path,processing_status,metadata)
  values(p_user_id,p_connection_id,'calendar','calendar_event',p_event_id,'primary',p_title,p_original_url,
    p_content_text,p_content_hash,p_source_created_at,p_source_updated_at,null,null,'queued',jsonb_build_object('calendar',p_calendar_metadata))
    returning id into v_id;
  return jsonb_build_object('item_id',v_id,'outcome','created');
end;
$$;
revoke all on function public.persist_calendar_item(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,jsonb,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.persist_calendar_item(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,jsonb,timestamptz) to service_role;
commit;
