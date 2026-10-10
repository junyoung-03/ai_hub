-- Application stale/lease/CAS conflicts must not trigger PostgREST serialization retries.
-- Only the eight STALE_ATTEMPT raises change: SQLSTATE 40001 -> PT409 (HTTP 409).
-- CREATE OR REPLACE preserves owner/ACL; signature, security, search_path and business logic are unchanged.
begin;
do $guard$
declare body_hash text;
begin
  select md5(prosrc) into body_hash from pg_proc
    where oid='public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure;
  if body_hash not in ('73f86bc776f9e1aab0f888b1d4740339','a2cc2ce8f1742254daa8c104dd4cbe53') then
    raise exception 'UPLOAD_RPC_DEFINITION_DRIFT';
  end if;
end;
$guard$;
create or replace function public.upload_session_rpc(p_operation text,p_user_id uuid,p_upload_id uuid,p_key uuid,p_request jsonb,p_payload jsonb,p_attempt uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.upload_sessions%rowtype; i public.items%rowtype; req_hash text; ext text; existing_id uuid; fresh_id uuid; stamp timestamptz;
  page jsonb; last_end integer:=0; page_no integer:=0; text_value text; count_chars integer; raw text; err text;
begin
  if p_user_id is null or not exists(select 1 from public.users where id=p_user_id) then raise exception 'UPLOAD_OWNER' using errcode='22023'; end if;
  -- Short DB critical sections only. No Storage/parser/OCR HTTP under this lock.
  perform pg_advisory_xact_lock(731,1);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,731));
  if p_operation='create' then
    if p_key is null or jsonb_typeof(p_request) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_request))<>3
      or jsonb_typeof(p_request->'fileName') is distinct from 'string' or jsonb_typeof(p_request->'mimeType') is distinct from 'string'
      or jsonb_typeof(p_request->'size') is distinct from 'number'
      or p_request->>'fileName' is null or length(p_request->>'fileName') not between 1 and 200
      or p_request->>'fileName' ~ '[[:cntrl:]\\/<>:"|?*]' or btrim(p_request->>'fileName')<>p_request->>'fileName'
      or coalesce((p_request->>'size')::bigint,0) not between 1 and 5000000 then raise exception 'UPLOAD_REQUEST' using errcode='22023'; end if;
    ext:=case p_request->>'mimeType' when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' end;
    if ext is null or lower(p_request->>'fileName') !~ (case when ext='jpg' then '[.](jpg|jpeg)$' else '[.]'||ext||'$' end) then raise exception 'UPLOAD_REQUEST' using errcode='22023'; end if;
    req_hash:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
    select * into s from private.upload_sessions where user_id=p_user_id and idempotency_key=p_key for update;
    if found then
      if s.request_hash<>req_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    else
      fresh_id:=gen_random_uuid();
      insert into private.upload_sessions(id,user_id,idempotency_key,request,request_hash,storage_path)
        values(fresh_id,p_user_id,p_key,p_request,req_hash,p_user_id::text||'/'||fresh_id::text||'/original.'||ext) returning * into s;
    end if;
  else
    select * into s from private.upload_sessions where id=p_upload_id and user_id=p_user_id for update;
    if not found then raise exception 'UPLOAD_MISSING' using errcode='22023'; end if;
  end if;
  ext:=case s.request->>'mimeType' when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' end;
  if s.storage_path<>p_user_id::text||'/'||s.id::text||'/original.'||ext then raise exception 'UPLOAD_PATH' using errcode='22023'; end if;
  if p_operation in ('create','read') then null;
  elsif p_operation='issue' then
    if s.state<>'pending' or clock_timestamp()>s.expires_at then raise exception 'UPLOAD_EXPIRED' using errcode='22023'; end if;
    update private.upload_sessions set cleanup_after=clock_timestamp()+interval '2 hours 15 minutes' where id=s.id returning * into s;
  elsif p_operation='reserve' then
    if s.state not in ('pending','stored','failed','running') or (s.state='pending' and clock_timestamp()>s.expires_at) then raise exception 'UPLOAD_EXPIRED' using errcode='22023'; end if;
    if exists(select 1 from private.upload_sessions where state in ('pending','stored','failed','running') and lease_until>clock_timestamp()) then raise exception 'UPLOAD_IN_PROGRESS' using errcode='55P03'; end if;
    -- Reclaim only an expired running attempt; preserve snapshot CAS before preparing again.
    if s.state='running' then
      update public.items set processing_status='failed',processing_error='PROCESSING_TIMEOUT',
        metadata=jsonb_set(metadata,'{upload,extraction}',jsonb_build_object('version','upload-text-v1','status','failed','error','PROCESSING_TIMEOUT','pages','[]'::jsonb))
        where id=s.item_id and user_id=p_user_id and source='upload' and external_id=s.id::text and updated_at=s.item_snapshot and processing_status='extracting';
      if not found then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
      update private.upload_sessions set state='failed' where id=s.id returning * into s;
    end if;
    update private.upload_sessions set attempt=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>least(120000,greatest(1,coalesce((p_payload->>'leaseMs')::integer,120000)))/1000.0) where id=s.id returning * into s;
  elsif p_operation='release' then
    if p_attempt is distinct from s.attempt or s.state not in ('pending','stored','failed','running') then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
    if s.state='running' then raise exception 'UPLOAD_STATE' using errcode='22023'; end if;
    update private.upload_sessions set attempt=null,lease_until=null where id=s.id returning * into s;
  elsif p_operation='pending' then
    if s.attempt is not null and (p_attempt is distinct from s.attempt or s.lease_until<clock_timestamp()) then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
    if s.raw_hash is not null and s.raw_hash is distinct from p_payload->>'rawHash' then raise exception 'UPLOAD_HASH' using errcode='22023'; end if;
    if s.item_id is null then
      if s.state<>'pending' or clock_timestamp()>s.expires_at then raise exception 'UPLOAD_EXPIRED' using errcode='22023'; end if;
      raw:=p_payload->>'rawHash';
      if raw is null or raw !~ '^[0-9a-f]{64}$' then raise exception 'UPLOAD_HASH' using errcode='22023'; end if;
      select id into existing_id from public.items where user_id=p_user_id and source='upload' and metadata#>>'{upload,rawHash}'=raw;
      if existing_id is not null then
        if not exists(select 1 from public.items where id=existing_id and metadata#>>'{upload,extraction,status}'='complete') then
          raise exception 'UPLOAD_IN_PROGRESS' using errcode='55P03';
        end if;
        update private.upload_sessions set item_id=existing_id,state='reused',raw_hash=raw,attempt=null,lease_until=null where id=s.id returning * into s;
      else
        insert into public.items(user_id,source,format,external_id,title,storage_path,mime_type,processing_status,metadata)
          values(p_user_id,'upload',case when ext='pdf' then 'pdf'::public.item_format else 'image'::public.item_format end,s.id::text,
            s.request->>'fileName',s.storage_path,s.request->>'mimeType','uploaded',jsonb_build_object('upload',jsonb_build_object(
              'rawHash',raw,'size',(s.request->>'size')::bigint,'validated',true,'extraction',jsonb_build_object('version','upload-text-v1','status','pending','pages','[]'::jsonb)))) returning id into existing_id;
        update public.items set processing_status='queued' where id=existing_id;
        update private.upload_sessions set item_id=existing_id,state='stored',raw_hash=raw where id=s.id returning * into s;
      end if;
    end if;
  elsif p_operation='claim' then
    if s.state in ('complete','reused') then null;
    else
      if s.item_id is null or s.state not in ('stored','running','failed') then raise exception 'UPLOAD_STATE' using errcode='22023'; end if;
      if (s.lease_until>clock_timestamp() and p_attempt is distinct from s.attempt) or exists(select 1 from private.upload_sessions where id<>s.id and state in ('pending','stored','failed','running') and lease_until>clock_timestamp()) then raise exception 'UPLOAD_IN_PROGRESS' using errcode='55P03'; end if;
      if p_attempt is not null and (p_attempt is distinct from s.attempt or s.lease_until<clock_timestamp()) then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
      select * into i from public.items where id=s.item_id and user_id=p_user_id and source='upload' and external_id=s.id::text for update;
      if not found then raise exception 'UPLOAD_OWNER' using errcode='22023'; end if;
      update public.items set processing_status='extracting',processing_error=null,
        metadata=jsonb_set(metadata,'{upload,extraction}',jsonb_build_object('version','upload-text-v1','status','running','pages','[]'::jsonb)) where id=i.id returning updated_at into stamp;
      update private.upload_sessions set state='running',attempt=gen_random_uuid(),lease_until=case when p_attempt is not null then s.lease_until else clock_timestamp()+make_interval(secs=>least(120000,greatest(1,coalesce((p_payload->>'leaseMs')::integer,120000)))/1000.0) end,item_snapshot=stamp where id=s.id returning * into s;
    end if;
  elsif p_operation in ('finish','fail') then
    if s.state<>'running' or p_attempt is distinct from s.attempt or (p_operation='finish' and s.lease_until<clock_timestamp()) then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
    select * into i from public.items where id=s.item_id and user_id=p_user_id and source='upload' and external_id=s.id::text for update;
    if not found or i.updated_at is distinct from s.item_snapshot or i.processing_status<>'extracting' then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
    if p_operation='finish' then
      text_value:=p_payload->>'text'; count_chars:=char_length(text_value);
      if text_value is null or nullif(btrim(text_value),'') is null or count_chars>100000 or octet_length(text_value)>400000
        or jsonb_typeof(p_payload->'text') is distinct from 'string'
        or p_payload->>'hash' is distinct from encode(sha256(convert_to(text_value,'UTF8')),'hex')
        or p_payload->>'version' is distinct from 'upload-text-v1' or p_payload->>'status' is distinct from 'complete'
        or jsonb_typeof(p_payload->'pages') is distinct from 'array' or jsonb_array_length(p_payload->'pages') not between 1 and 10
        or (ext<>'pdf' and jsonb_array_length(p_payload->'pages')<>1)
        or (select count(*) from jsonb_object_keys(p_payload))<>11
        or not (p_payload ?& array['version','status','text','hash','pages','method','provider','providerVersion','execution','language','extractionVersion'])
        or p_payload->>'extractionVersion' is distinct from 'upload-text-v1'
        or text_value is distinct from normalize(text_value,NFC)
        or text_value ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then raise exception 'UPLOAD_EXTRACTION' using errcode='22023'; end if;
      for page in select * from jsonb_array_elements(p_payload->'pages') loop
        page_no:=page_no+1;
        if jsonb_typeof(page) is distinct from 'object' or (select count(*) from jsonb_object_keys(page))<>10
          or not (page ?& array['page','start','end','method','provider','confidence','providerVersion','execution','language','extractionVersion'])
          or jsonb_typeof(page->'page') is distinct from 'number' or jsonb_typeof(page->'start') is distinct from 'number' or jsonb_typeof(page->'end') is distinct from 'number'
          or (page->>'page')::numeric<>page_no or (page->>'start')::numeric<>last_end+(case when page_no=1 then 0 else 2 end)
          or (page->>'end')::numeric<>trunc((page->>'end')::numeric)
          or (page->>'end')::integer<(page->>'start')::integer or (page->>'end')::integer>count_chars
          or coalesce(page->>'method','') not in ('embedded','ocr')
          or page->>'extractionVersion' is distinct from 'upload-text-v1'
          or (page->>'method'='embedded' and (page->>'provider' is distinct from 'pdfjs' or page->>'providerVersion' is distinct from '6.4.299' or page->>'execution' is distinct from 'server' or page->'language' is distinct from 'null'::jsonb or page->'confidence' is distinct from 'null'::jsonb))
          or (page->>'method'='ocr' and (page->>'provider' is distinct from 'tesseract.js' or page->>'providerVersion' is distinct from '7.0.0' or page->>'execution' is distinct from 'client' or page->>'language' is distinct from 'kor+eng'))
          or (ext<>'pdf' and page->>'method' is distinct from 'ocr')
          or (page->>'method'='ocr' and (page->>'end')::integer=(page->>'start')::integer)
          or (page->'confidence'<>'null'::jsonb and (jsonb_typeof(page->'confidence') is distinct from 'number' or (page->>'confidence')::numeric not between 0 and 1))
          or (page_no>1 and substring(text_value from last_end+1 for 2)<>E'\n\n') then raise exception 'UPLOAD_RANGE' using errcode='22023'; end if;
        last_end:=(page->>'end')::integer;
      end loop;
      if p_payload->>'method' is distinct from (select case when count(distinct p->>'method')>1 then 'mixed' else min(p->>'method') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->>'provider' is distinct from (select case when count(distinct p->>'provider')>1 then 'mixed' else min(p->>'provider') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->>'execution' is distinct from (select case when count(distinct p->>'execution')>1 then 'mixed' else min(p->>'execution') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->>'providerVersion' is distinct from (select case when count(distinct p->>'providerVersion')>1 then 'mixed' else min(p->>'providerVersion') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->'language' is distinct from (case when exists(select 1 from jsonb_array_elements(p_payload->'pages') p where p->>'method'='ocr') then '"kor+eng"'::jsonb else 'null'::jsonb end)
        then raise exception 'UPLOAD_ORIGIN' using errcode='22023'; end if;
      if last_end<>count_chars then raise exception 'UPLOAD_RANGE' using errcode='22023'; end if;
      update public.items set content_text=text_value,content_hash=p_payload->>'hash',processing_status='queued',processing_error=null,
        metadata=jsonb_set(metadata,'{upload,extraction}',p_payload-'text'-'hash') where id=i.id;
      update private.upload_sessions set state='complete',attempt=null,lease_until=null where id=s.id returning * into s;
    else
      err:=p_payload->>'error';
      if err is null or err not in ('FILE_LIMIT','INVALID_FILE','PDF_ENCRYPTED','PDF_UNSAFE','PDF_LAYOUT_NEEDS_REVIEW','TEXT_LIMIT','EMPTY_TEXT','OCR_UNAVAILABLE','OCR_FAILED','PROCESSING_TIMEOUT','WORKER_UNAVAILABLE','STORAGE_UNAVAILABLE') then raise exception 'UPLOAD_ERROR' using errcode='22023'; end if;
      update public.items set processing_status='failed',processing_error=err,
        metadata=jsonb_set(metadata,'{upload,extraction}',jsonb_build_object('version','upload-text-v1','status','failed','error',err,'pages','[]'::jsonb)) where id=i.id;
      update private.upload_sessions set state='failed',attempt=null,lease_until=null where id=s.id returning * into s;
    end if;
  elsif p_operation='reject' then
    if s.attempt is not null and p_attempt is distinct from s.attempt then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
    if s.item_id is not null or s.state<>'pending' then raise exception 'UPLOAD_STATE' using errcode='22023'; end if;
    update private.upload_sessions set state='rejected',attempt=null,lease_until=null where id=s.id returning * into s;
  elsif p_operation='cleanup_claim' then
    if s.cleanup_after>clock_timestamp() or (s.lease_until>clock_timestamp()) or exists(select 1 from public.items where storage_path=s.storage_path)
      or s.state not in ('pending','rejected','reused','cleaning') then raise exception 'UPLOAD_CLEANUP_UNSAFE' using errcode='22023'; end if;
    update private.upload_sessions set state='cleaning',attempt=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds' where id=s.id returning * into s;
  elsif p_operation='cleanup_done' then
    if s.state<>'cleaning' or p_attempt is distinct from s.attempt then raise sqlstate 'PT409' using message='STALE_ATTEMPT'; end if;
    update private.upload_sessions set state=case when item_id is null then 'cleaned' else 'reused' end,attempt=null,lease_until=null,cleanup_after='infinity' where id=s.id returning * into s;
  else raise exception 'UPLOAD_OPERATION' using errcode='22023'; end if;
  return jsonb_build_object('id',s.id,'state',s.state,'request',s.request,'path',s.storage_path,'itemId',s.item_id,
    'attempt',s.attempt,'rawHash',s.raw_hash,'expiresAt',s.expires_at,'cleanupAfter',s.cleanup_after);
end;
$$;
commit;
