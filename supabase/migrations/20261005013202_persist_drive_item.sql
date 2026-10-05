-- Drive-3 approved function-only migration. Target: ai-hub-dev.
-- No table/column/index/RLS changes. Google network requests occur outside this transaction.
begin;
create function public.persist_drive_item(
  p_user_id uuid, p_connection_id uuid, p_file_id text,
  p_title text, p_original_url text, p_content_text text, p_content_hash text,
  p_source_created_at timestamptz, p_source_updated_at timestamptz,
  p_drive_metadata jsonb, p_expected_item_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_connection public.connections%rowtype; v_item public.items%rowtype; v_id uuid;
begin
  -- Connection row serializes creates/updates with disconnect across processes.
  select * into v_connection from public.connections where id=p_connection_id and user_id=p_user_id
    and provider='google' and status='connected' for update;
  if not found then raise exception 'Connection unavailable' using errcode='22023'; end if;
  if coalesce('https://www.googleapis.com/auth/drive.metadata.readonly'=any(v_connection.scopes),false) is not true
    or coalesce('https://www.googleapis.com/auth/documents.readonly'=any(v_connection.scopes),false) is not true
    or not exists(select 1 from private.google_connection_tokens where connection_id=p_connection_id and user_id=p_user_id) then
    raise exception 'Drive authorization required' using errcode='22023';
  end if;
  if p_file_id is null or p_file_id !~ '^[A-Za-z0-9_-]{1,255}$'
    or p_title is null or p_content_text is null or p_source_updated_at is null or p_source_created_at is null
    or p_original_url is null or p_original_url !~ ('^https://docs[.]google[.]com/document/d/'||p_file_id||'([/?#]|$)')
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or char_length(p_content_text)>100000 or octet_length(p_content_text)>400000
    or jsonb_typeof(p_drive_metadata) is distinct from 'object' then
    raise exception 'Invalid Drive input' using errcode='22023';
  end if;
  if p_content_hash is distinct from encode(sha256(convert_to(p_content_text,'UTF8')),'hex') then
    raise exception 'Content hash mismatch' using errcode='22023';
  end if;
  -- p_drive_metadata is scoped under metadata.drive; it cannot overwrite aiAnalysis.
  select * into v_item from public.items where user_id=p_user_id and connection_id=p_connection_id
    and source='drive' and external_container_id is null and external_id=p_file_id for update;
  if found then
    if v_item.source_updated_at>p_source_updated_at then
      raise exception 'Stale source snapshot' using errcode='40001';
    end if;
    if v_item.source_updated_at=p_source_updated_at then
      if v_item.content_hash is distinct from p_content_hash then
        raise exception 'Same source version has conflicting content' using errcode='40001';
      end if;
      return jsonb_build_object('item_id',v_item.id,'outcome','reused');
    end if;
    if p_expected_item_updated_at is null or v_item.updated_at is distinct from p_expected_item_updated_at then
      raise exception 'ITEM changed during collection' using errcode='40001';
    end if;
    update public.items set title=p_title, original_url=p_original_url,
      content_text=p_content_text, content_hash=p_content_hash,
      source_created_at=p_source_created_at, source_updated_at=p_source_updated_at,
      metadata=metadata || jsonb_build_object('drive',p_drive_metadata)
      where id=v_item.id and user_id=p_user_id;
    return jsonb_build_object('item_id',v_item.id,'outcome','updated');
  end if;
  if p_expected_item_updated_at is not null then raise exception 'Expected ITEM missing' using errcode='40001'; end if;
  insert into public.items(user_id,connection_id,source,format,external_id,external_container_id,
    title,original_url,storage_path,mime_type,content_text,content_hash,metadata,
    source_created_at,source_updated_at,processing_status)
  values(p_user_id,p_connection_id,'drive','document',p_file_id,null,p_title,p_original_url,null,
    'application/vnd.google-apps.document',p_content_text,p_content_hash,jsonb_build_object('drive',p_drive_metadata),
    p_source_created_at,p_source_updated_at,'queued') returning id into v_id;
  return jsonb_build_object('item_id',v_id,'outcome','created');
end;
$$;
revoke all on function public.persist_drive_item(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,jsonb,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.persist_drive_item(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,jsonb,timestamptz) to service_role;
commit;
