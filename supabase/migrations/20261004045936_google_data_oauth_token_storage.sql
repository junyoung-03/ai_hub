-- DRAFT ONLY: do not apply until the token-storage design is approved.
-- Google Data OAuth tokens are encrypted by the Next.js server with AES-256-GCM
-- before they cross the database boundary. The encryption key never enters Postgres.

begin;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated, service_role;

alter table public.connections
  add column connected_at timestamptz,
  add column disconnected_at timestamptz;

create table private.google_connection_tokens (
  connection_id uuid primary key,
  user_id uuid not null,

  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_tag text not null,

  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,

  token_expires_at timestamptz not null,
  encryption_version smallint not null default 1
    check (encryption_version = 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint google_connection_tokens_connection_user_fk
    foreign key (connection_id, user_id)
    references public.connections(id, user_id)
    on delete cascade
);

alter table private.google_connection_tokens enable row level security;

revoke all privileges on table private.google_connection_tokens
  from public, anon, authenticated, service_role;

comment on table private.google_connection_tokens is
  'Server-encrypted Google OAuth credentials. No Data API role has direct table access.';

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
    or cardinality(p_scopes) > 6
    or not ('https://www.googleapis.com/auth/gmail.readonly' = any(p_scopes))
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
          'https://www.googleapis.com/auth/gmail.readonly'
        )
    )
  then
    raise exception using errcode = '22023', message = 'Invalid Google OAuth scopes';
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

create or replace function public.get_google_connection_tokens(
  p_user_id uuid,
  p_connection_id uuid
)
returns table (
  access_token_ciphertext text,
  access_token_iv text,
  access_token_tag text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_tag text,
  token_expires_at timestamptz,
  encryption_version smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_connection_id is null then
    raise exception using errcode = '22023', message = 'User ID and connection ID are required';
  end if;

  return query
  select
    tokens.access_token_ciphertext,
    tokens.access_token_iv,
    tokens.access_token_tag,
    tokens.refresh_token_ciphertext,
    tokens.refresh_token_iv,
    tokens.refresh_token_tag,
    tokens.token_expires_at,
    tokens.encryption_version
  from private.google_connection_tokens as tokens
  join public.connections as connection
    on connection.id = tokens.connection_id
   and connection.user_id = tokens.user_id
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.provider = 'google'
    and connection.status = 'connected';
end;
$$;

create or replace function public.refresh_google_connection_tokens(
  p_user_id uuid,
  p_connection_id uuid,
  p_access_token_ciphertext text,
  p_access_token_iv text,
  p_access_token_tag text,
  p_refresh_token_ciphertext text,
  p_refresh_token_iv text,
  p_refresh_token_tag text,
  p_token_expires_at timestamptz,
  p_encryption_version smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_connection_id is null then
    raise exception using errcode = '22023', message = 'User ID and connection ID are required';
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

  update private.google_connection_tokens as tokens
  set access_token_ciphertext = p_access_token_ciphertext,
      access_token_iv = p_access_token_iv,
      access_token_tag = p_access_token_tag,
      refresh_token_ciphertext = coalesce(
        p_refresh_token_ciphertext,
        tokens.refresh_token_ciphertext
      ),
      refresh_token_iv = coalesce(
        p_refresh_token_iv,
        tokens.refresh_token_iv
      ),
      refresh_token_tag = coalesce(
        p_refresh_token_tag,
        tokens.refresh_token_tag
      ),
      token_expires_at = p_token_expires_at,
      encryption_version = p_encryption_version,
      updated_at = now()
  from public.connections as connection
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.provider = 'google'
    and connection.status = 'connected'
    and tokens.connection_id = connection.id
    and tokens.user_id = connection.user_id;

  if not found then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.disconnect_google_connection(
  p_connection_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  update public.connections
  set status = 'disconnected',
      disconnected_at = now(),
      updated_at = now()
  where id = p_connection_id
    and user_id = v_user_id
    and provider = 'google';

  if not found then
    return false;
  end if;

  -- Local credentials are removed so disconnected accounts cannot be synced.
  -- Google-side grant revocation is intentionally outside this draft because
  -- API_SPEC v0.1 does not yet define that behavior.
  delete from private.google_connection_tokens
  where connection_id = p_connection_id
    and user_id = v_user_id;

  return true;
end;
$$;

revoke all on function public.upsert_google_connection(
  uuid,
  text, text, text[], text,
  text, text, text,
  text, text, text,
  timestamptz, smallint
) from public, anon, authenticated, service_role;

revoke all on function public.get_google_connection_tokens(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.refresh_google_connection_tokens(
  uuid, uuid,
  text, text, text,
  text, text, text,
  timestamptz, smallint
) from public, anon, authenticated, service_role;

revoke all on function public.disconnect_google_connection(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.upsert_google_connection(
  uuid,
  text, text, text[], text,
  text, text, text,
  text, text, text,
  timestamptz, smallint
) to service_role;

grant execute on function public.get_google_connection_tokens(uuid, uuid)
  to service_role;

grant execute on function public.refresh_google_connection_tokens(
  uuid, uuid,
  text, text, text,
  text, text, text,
  timestamptz, smallint
) to service_role;

grant execute on function public.disconnect_google_connection(uuid)
  to authenticated;

commit;
