-- Calendar-2 DRAFT ONLY. No remote application authorized. Functions only.
begin;
create or replace function public.upsert_google_connection(
  p_user_id uuid,
  p_provider_account_id text,
  p_account_email text,
  p_scopes text[],
  p_gmail_history_id text,
  p_access_token_ciphertext text,
  p_access_token_iv text,
  p_access_token_tag text,
  p_refresh_token_ciphertext text,
  p_refresh_token_iv text,
  p_refresh_token_tag text,
  p_token_expires_at timestamptz,
  p_encryption_version smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_refresh_token_ciphertext text;
  v_refresh_token_iv text;
  v_refresh_token_tag text;
  v_existing_token boolean := false;
  v_has_refresh_token boolean := p_refresh_token_ciphertext is not null;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'User ID is required';
  end if;

  if nullif(btrim(p_provider_account_id), '') is null
    or length(p_provider_account_id) > 255
    or nullif(btrim(p_account_email), '') is null
    or length(p_account_email) > 320
    or p_account_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or nullif(btrim(p_gmail_history_id), '') is null
    or p_gmail_history_id !~ '^[0-9]+$'
    or length(p_gmail_history_id) > 20
  then
    raise exception using errcode = '22023', message = 'Invalid Google connection identity';
  end if;

  if p_scopes is null
    or cardinality(p_scopes) < 1
    or cardinality(p_scopes) > 9
    or not ('https://www.googleapis.com/auth/gmail.readonly' = any(p_scopes))
    or (('https://www.googleapis.com/auth/drive.metadata.readonly'=any(p_scopes))
        is distinct from ('https://www.googleapis.com/auth/documents.readonly'=any(p_scopes)))
    or exists (
      select 1
      from unnest(p_scopes) as granted_scope(scope_value)
      where nullif(btrim(granted_scope.scope_value), '') is null
        or granted_scope.scope_value not in (
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/drive.metadata.readonly',
          'https://www.googleapis.com/auth/documents.readonly',
          'https://www.googleapis.com/auth/calendar.events.owned.readonly'
        )
    )
  then
    raise exception using errcode = '22023', message = 'Invalid Google OAuth scopes';
  end if;

  -- Existing data capabilities may not be downgraded by a normal reconnect.
  -- Take the same connection lock BEFORE testing scopes, so an upgrade cannot
  -- race the check and then be overwritten by an older normal OAuth response.
  perform 1 from public.connections where user_id=p_user_id and provider='google'
    and provider_account_id=p_provider_account_id for update;
  if exists (
    select 1 from public.connections c, unnest(c.scopes) s
    where c.user_id=p_user_id and c.provider='google' and c.provider_account_id=p_provider_account_id
      and s in ('https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/drive.metadata.readonly',
                'https://www.googleapis.com/auth/documents.readonly',
                'https://www.googleapis.com/auth/calendar.events.owned.readonly')
      and not (s=any(p_scopes))
  ) then
    raise exception 'Google data scopes cannot be reduced' using errcode='22023';
  end if;
  if nullif(btrim(p_access_token_ciphertext), '') is null
    or length(p_access_token_ciphertext) > 16384
    or nullif(btrim(p_access_token_iv), '') is null
    or length(p_access_token_iv) > 64
    or nullif(btrim(p_access_token_tag), '') is null
    or length(p_access_token_tag) > 64
    or p_token_expires_at is null
    or p_token_expires_at <= now()
    or p_encryption_version is null
    or p_encryption_version <> 1
  then
    raise exception using errcode = '22023', message = 'Invalid encrypted access token';
  end if;

  if p_refresh_token_ciphertext is null
    and p_refresh_token_iv is null
    and p_refresh_token_tag is null
  then
    null;
  elsif p_refresh_token_ciphertext is null
    or p_refresh_token_iv is null
    or p_refresh_token_tag is null
    or nullif(btrim(p_refresh_token_ciphertext), '') is null
    or nullif(btrim(p_refresh_token_iv), '') is null
    or nullif(btrim(p_refresh_token_tag), '') is null
    or length(p_refresh_token_ciphertext) > 16384
    or length(p_refresh_token_iv) > 64
    or length(p_refresh_token_tag) > 64
  then
    raise exception using errcode = '22023', message = 'Invalid encrypted refresh token';
  end if;

  insert into public.connections as existing_connection (
    user_id,
    provider,
    provider_account_id,
    account_email,
    status,
    scopes,
    sync_state,
    connected_at,
    disconnected_at
  )
  values (
    p_user_id,
    'google',
    p_provider_account_id,
    p_account_email,
    'connected',
    p_scopes,
    jsonb_build_object(
      'gmail', jsonb_build_object('history_id', p_gmail_history_id)
    ),
    now(),
    null
  )
  on conflict (user_id, provider, provider_account_id)
    where provider_account_id is not null
  do update
  set account_email = excluded.account_email,
      status = 'connected',
      scopes = excluded.scopes,
      sync_state = coalesce(existing_connection.sync_state, '{}'::jsonb)
        || jsonb_build_object(
          'gmail',
          coalesce(existing_connection.sync_state -> 'gmail', '{}'::jsonb)
            || jsonb_build_object('history_id', p_gmail_history_id)
        ),
      connected_at = now(),
      disconnected_at = null,
      updated_at = now()
  returning existing_connection.id into v_connection_id;

  select
    refresh_token_ciphertext,
    refresh_token_iv,
    refresh_token_tag
  into
    v_refresh_token_ciphertext,
    v_refresh_token_iv,
    v_refresh_token_tag
  from private.google_connection_tokens
  where connection_id = v_connection_id
    and user_id = p_user_id
  for update;

  v_existing_token := found;

  if not v_has_refresh_token and not v_existing_token then
    raise exception using errcode = '22023', message = 'Refresh token required for first connection';
  end if;

  insert into private.google_connection_tokens (
    connection_id,
    user_id,
    access_token_ciphertext,
    access_token_iv,
    access_token_tag,
    refresh_token_ciphertext,
    refresh_token_iv,
    refresh_token_tag,
    token_expires_at,
    encryption_version
  )
  values (
    v_connection_id,
    p_user_id,
    p_access_token_ciphertext,
    p_access_token_iv,
    p_access_token_tag,
    coalesce(p_refresh_token_ciphertext, v_refresh_token_ciphertext),
    coalesce(p_refresh_token_iv, v_refresh_token_iv),
    coalesce(p_refresh_token_tag, v_refresh_token_tag),
    p_token_expires_at,
    p_encryption_version
  )
  on conflict (connection_id) do update
  set access_token_ciphertext = excluded.access_token_ciphertext,
      access_token_iv = excluded.access_token_iv,
      access_token_tag = excluded.access_token_tag,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      refresh_token_iv = excluded.refresh_token_iv,
      refresh_token_tag = excluded.refresh_token_tag,
      token_expires_at = excluded.token_expires_at,
      encryption_version = excluded.encryption_version,
      updated_at = now();

  return v_connection_id;
end;
$$;

create function public.upgrade_google_calendar_scopes(
  p_user_id uuid, p_connection_id uuid, p_provider_account_id text, p_account_email text,
  p_scopes text[], p_expected_connection_updated_at timestamptz, p_expected_access_token_ciphertext text,
  p_access_token_ciphertext text, p_access_token_iv text, p_access_token_tag text,
  p_refresh_token_ciphertext text, p_refresh_token_iv text, p_refresh_token_tag text,
  p_token_expires_at timestamptz, p_encryption_version smallint
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_connection public.connections%rowtype; v_ciphertext text; v_id uuid;
begin
  select * into v_connection from public.connections where id=p_connection_id and user_id=p_user_id
    and provider='google' and status='connected' and provider_account_id=p_provider_account_id for update;
  if not found or p_expected_connection_updated_at is null
    or v_connection.updated_at is distinct from p_expected_connection_updated_at then
    raise exception 'Connection changed during consent' using errcode='40001';
  end if;
  select access_token_ciphertext into v_ciphertext from private.google_connection_tokens
    where connection_id=p_connection_id and user_id=p_user_id for update;
  if not found or p_expected_access_token_ciphertext is null
    or v_ciphertext is distinct from p_expected_access_token_ciphertext then
    raise exception 'Credentials changed during consent' using errcode='40001';
  end if;
  if p_scopes is null
    or coalesce('https://www.googleapis.com/auth/calendar.events.owned.readonly'=any(p_scopes),false) is not true
    or p_refresh_token_ciphertext is null then
    raise exception 'Incomplete scope upgrade' using errcode='22023';
  end if;
  v_id := public.upsert_google_connection(p_user_id,p_provider_account_id,p_account_email,p_scopes,
    v_connection.sync_state#>>'{gmail,history_id}',
    p_access_token_ciphertext,p_access_token_iv,p_access_token_tag,
    p_refresh_token_ciphertext,p_refresh_token_iv,p_refresh_token_tag,p_token_expires_at,p_encryption_version);
  if v_id is distinct from p_connection_id then raise exception 'Connection mismatch' using errcode='22023'; end if;
  -- Preserve the entire Gmail/other source state and timestamps in the same transaction.
  update public.connections set sync_state=v_connection.sync_state,
    last_synced_at=v_connection.last_synced_at, connected_at=v_connection.connected_at where id=v_id and user_id=p_user_id;
  return v_id;
end;
$$;

revoke all on function public.upsert_google_connection(uuid,text,text,text[],text,text,text,text,text,text,text,timestamptz,smallint) from public,anon,authenticated,service_role;
grant execute on function public.upsert_google_connection(uuid,text,text,text[],text,text,text,text,text,text,text,timestamptz,smallint) to service_role;
revoke all on function public.upgrade_google_calendar_scopes(uuid,uuid,text,text,text[],timestamptz,text,text,text,text,text,text,text,timestamptz,smallint) from public,anon,authenticated,service_role;
grant execute on function public.upgrade_google_calendar_scopes(uuid,uuid,text,text,text[],timestamptz,text,text,text,text,text,text,text,timestamptz,smallint) to service_role;
commit;
