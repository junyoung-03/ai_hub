-- ============================================================================
-- AI 통합 정보 허브
-- Migration: 0001_initial_schema.sql
-- Revision: v0.5 REVIEW
-- 기준: Notion 「AI 통합 정보 허브 — 서비스 기획 및 개발 기준서 v0.5」
-- 목적: v1 핵심 DB 스키마 초기 생성
--
-- 중요:
-- - 이 파일은 v0.5 검토본이다.
-- - Supabase 적용 전 정적 검토 + 개발 DB 검증을 수행한다.
-- ============================================================================

begin;

-- ============================================================================
-- 0. Extensions
-- ============================================================================

create schema if not exists extensions;

-- 기존 vector extension의 위치를 임의로 이동하지 않는다.
-- public 또는 extensions에 있으면 그대로 사용하고, 없으면 extensions에 설치한다.
do $$
declare
  v_schema text;
begin
  select n.nspname
    into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';

  if v_schema is null then
    execute 'create extension vector with schema extensions';
  elsif v_schema not in ('public', 'extensions') then
    raise exception
      'vector extension is installed in unsupported schema "%"; expected public or extensions',
      v_schema;
  end if;
end
$$;

-- vector type이 public 또는 extensions 어느 쪽에 있어도 해석되도록 한다.
set local search_path = public, extensions, pg_catalog;

-- ============================================================================
-- 1. ENUM Types
-- ============================================================================

create type public.connection_provider as enum (
  'google'
);

create type public.connection_status as enum (
  'connected',
  'disconnected',
  'error'
);

create type public.item_source as enum (
  'gmail',
  'drive',
  'calendar',
  'upload',
  'manual'
);

create type public.item_format as enum (
  'email',
  'pdf',
  'image',
  'screenshot',
  'document',
  'text',
  'calendar_event',
  'other'
);

create type public.processing_status as enum (
  'uploaded',
  'queued',
  'extracting',
  'analyzing',
  'indexing',
  'completed',
  'failed'
);

-- UI 표시명
-- notice      = 공지·안내
-- application = 신청·접수
-- contract    = 계약·약관
-- billing     = 결제·청구
-- reservation = 예약·확인
-- certificate = 증명·제출서류
-- schedule    = 일정·초대
-- general     = 일반자료
-- other       = 기타
create type public.document_type as enum (
  'notice',
  'application',
  'contract',
  'billing',
  'reservation',
  'certificate',
  'schedule',
  'general',
  'other'
);

create type public.action_type as enum (
  'required',
  'optional',
  'check'
);

create type public.action_status as enum (
  'open',
  'completed'
);

create type public.deadline_status as enum (
  'confirmed',
  'needs_review',
  'none'
);

-- ============================================================================
-- 2. Core Tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 users
-- Supabase auth.users와 1:1로 연결되는 서비스 프로필
-- ----------------------------------------------------------------------------

create table public.users (
  id uuid primary key
    references auth.users(id)
    on delete cascade,

  display_name text,
  timezone text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'Supabase auth.users와 1:1로 연결되는 AI 통합 정보 허브 사용자 프로필';

-- ----------------------------------------------------------------------------
-- 2.2 connections
-- 동일 Google 계정 재연결 시 신규 row 생성 대신 기존 row 재사용을 원칙으로 한다.
-- OAuth token 저장 구조는 Google OAuth 설계 단계에서 별도 확정한다.
-- ----------------------------------------------------------------------------

create table public.connections (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  provider public.connection_provider not null default 'google',

  provider_account_id text,
  account_email text,

  status public.connection_status not null default 'disconnected',

  scopes text[] not null default '{}'::text[],
  sync_state jsonb not null default '{}'::jsonb,

  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),

  constraint connections_connected_account_identity_chk
    check (
      status <> 'connected'
      or nullif(btrim(provider_account_id), '') is not null
    )
);

create unique index connections_user_provider_account_uidx
  on public.connections (user_id, provider, provider_account_id)
  where provider_account_id is not null;

comment on table public.connections is
  'Google 외부 계정 연결 상태 및 동기화 상태. 연결 해제는 status 변경, 재연결은 기존 connection 재사용을 기본으로 한다.';

-- ----------------------------------------------------------------------------
-- 2.3 items
-- Gmail / Drive / Calendar / Upload / Manual을 모두 Unified ITEM으로 저장
--
-- Source identity rule:
-- Gmail    = connection_id + message_id
-- Drive    = connection_id + file_id
-- Calendar = connection_id + calendar_id + event_id
--
-- Gmail/Drive는 external_container_id를 사용하지 않는다.
-- Drive 폴더 이동은 ITEM identity에 영향을 주지 않는다.
-- ----------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  connection_id uuid,

  source public.item_source not null,
  format public.item_format not null,

  external_container_id text,
  external_id text,

  title text not null default '',
  original_url text,
  storage_path text,

  mime_type text,

  content_text text,
  content_hash text,

  metadata jsonb not null default '{}'::jsonb,

  processing_status public.processing_status not null default 'uploaded',
  processing_error text,

  source_created_at timestamptz,
  source_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),

  constraint items_connection_user_fk
    foreign key (connection_id, user_id)
    references public.connections(id, user_id),

  constraint items_google_source_identity_chk
    check (
      source not in ('gmail', 'drive', 'calendar')
      or (
        connection_id is not null
        and nullif(btrim(external_id), '') is not null
      )
    ),

  constraint items_source_container_scope_chk
    check (
      (
        source = 'calendar'
        and nullif(btrim(external_container_id), '') is not null
      )
      or
      (
        source in ('gmail', 'drive')
        and external_container_id is null
      )
      or
      source not in ('gmail', 'drive', 'calendar')
    ),

  constraint items_local_source_connection_chk
    check (
      source not in ('upload', 'manual')
      or connection_id is null
    ),

  constraint items_upload_storage_chk
    check (
      source <> 'upload'
      or nullif(btrim(storage_path), '') is not null
    ),

  constraint items_manual_content_chk
    check (
      source <> 'manual'
      or nullif(btrim(content_text), '') is not null
    )
);

create unique index items_google_external_identity_uidx
  on public.items (
    user_id,
    connection_id,
    source,
    (coalesce(external_container_id, '')),
    external_id
  )
  where source in ('gmail', 'drive', 'calendar')
    and external_id is not null;

comment on table public.items is
  '모든 입력 경로를 통합하는 Unified ITEM 핵심 테이블';

comment on column public.items.external_container_id is
  'Calendar의 calendarId처럼 external_id의 namespace가 필요한 Source에만 사용한다. Gmail/Drive는 NULL';

comment on column public.items.metadata is
  'Gmail sender/thread_id, Drive parent metadata, Calendar organizer/start/end 등 Source별 부가정보';

-- ----------------------------------------------------------------------------
-- 2.4 classifications
--
-- AI 값과 사용자 override 값을 물리적으로 분리한다.
-- 화면/검색 effective 값:
--   COALESCE(user_*, ai_*)
--
-- user_tags:
--   NULL = 사용자 override 없음
--   '{}' = 사용자가 태그를 모두 제거함
-- ----------------------------------------------------------------------------

create table public.classifications (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  item_id uuid not null,

  ai_primary_topic text,
  user_primary_topic text,

  ai_document_type public.document_type,
  user_document_type public.document_type,

  ai_tags text[] not null default '{}'::text[],
  user_tags text[],

  user_edited_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint classifications_item_user_fk
    foreign key (item_id, user_id)
    references public.items(id, user_id)
    on delete cascade,

  constraint classifications_one_per_item_uq
    unique (item_id)
);

comment on table public.classifications is
  'ITEM 분류. AI 값과 사용자 override 값을 분리해 AI 재분석이 사용자 수정값을 덮어쓰지 않도록 한다.';

comment on column public.classifications.user_tags is
  'NULL이면 사용자 override 없음. 빈 배열이면 사용자가 태그를 모두 제거한 상태';

-- ----------------------------------------------------------------------------
-- 2.5 actions
-- ----------------------------------------------------------------------------

create table public.actions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null,

  constraint actions_user_fk
    foreign key (user_id)
    references public.users(id)
    on delete cascade
    deferrable initially deferred,

  title text not null,

  action_type public.action_type not null,
  status public.action_status not null default 'open',

  deadline_status public.deadline_status not null default 'none',

  deadline_date date,
  deadline_at timestamptz,

  -- confirmed deadline이 어느 Evidence row에 근거하는지 추적한다.
  -- FK는 action_sources 생성 후 추가한다.
  deadline_source_id uuid,

  -- current Evidence 간 Deadline 충돌이 있는 상태에서 confirmed로 확정할 경우
  -- 왜 해당 근거를 선택했는지 기록한다.
  deadline_resolution_reason text,
  deadline_resolved_at timestamptz,

  start_date date,
  start_at timestamptz,

  requirements text[] not null default '{}'::text[],
  conditions text[] not null default '{}'::text[],

  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, user_id),

  constraint actions_deadline_consistency_chk
    check (
      (
        deadline_status = 'confirmed'
        and deadline_date is not null
      )
      or
      (
        deadline_status <> 'confirmed'
        and deadline_date is null
        and deadline_at is null
      )
    ),

  constraint actions_deadline_at_requires_date_chk
    check (
      deadline_at is null
      or deadline_date is not null
    ),

  constraint actions_resolution_reason_not_blank_chk
    check (
      deadline_resolution_reason is null
      or length(btrim(deadline_resolution_reason)) > 0
    ),

  constraint actions_resolution_metadata_consistency_chk
    check (
      (
        deadline_resolution_reason is null
        and deadline_resolved_at is null
      )
      or
      (
        deadline_resolution_reason is not null
        and deadline_resolved_at is not null
      )
    ),

  constraint actions_start_at_requires_date_chk
    check (
      start_at is null
      or start_date is not null
    ),

  constraint actions_completed_at_consistency_chk
    check (
      (status = 'completed' and completed_at is not null)
      or
      (status = 'open' and completed_at is null)
    )
);

comment on table public.actions is
  '사용자가 실제로 해야 하거나 선택해야 하는 행동과 D-Day 정보';

comment on constraint actions_user_fk on public.actions is
  'Auth 사용자 전체 삭제 cascade 중 Evidence 삭제 trigger가 Action을 touch-update하더라도 중간 상태의 즉시 FK 재검사로 삭제가 실패하지 않도록 commit 시점에 검증한다.';

-- ----------------------------------------------------------------------------
-- 2.6 action_sources
--
-- 동일 Action + ITEM도 변경 이력을 보존하기 위해 여러 history row를 가질 수 있다.
-- action + item 조합에서 current row는 최대 1개만 허용한다.
-- ----------------------------------------------------------------------------

create table public.action_sources (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  action_id uuid not null,
  item_id uuid not null,

  evidence_text text not null,
  evidence_locator jsonb not null default '{}'::jsonb,

  observed_deadline_date date,
  observed_deadline_at timestamptz,

  is_current boolean not null default true,
  observed_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  constraint action_sources_action_user_fk
    foreign key (action_id, user_id)
    references public.actions(id, user_id)
    on delete cascade,

  constraint action_sources_item_user_fk
    foreign key (item_id, user_id)
    references public.items(id, user_id)
    on delete cascade,

  constraint action_sources_evidence_not_blank_chk
    check (length(btrim(evidence_text)) > 0),

  constraint action_sources_observed_deadline_at_requires_date_chk
    check (
      observed_deadline_at is null
      or observed_deadline_date is not null
    )
);

create unique index action_sources_one_current_per_item_uidx
  on public.action_sources (action_id, item_id)
  where is_current;

comment on table public.action_sources is
  'Action과 원본 ITEM을 연결하고 Evidence 및 Source별 Deadline 변경 이력을 보존';

-- selected deadline source는 같은 Action에 속한 Evidence row여야 한다.
alter table public.actions
  add constraint actions_deadline_source_fk
  foreign key (deadline_source_id)
  references public.action_sources(id)
  on delete set null
  deferrable initially deferred;

-- ----------------------------------------------------------------------------
-- 2.7 search_chunks
-- ----------------------------------------------------------------------------

create table public.search_chunks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  item_id uuid,
  action_id uuid,

  chunk_index integer not null
    check (chunk_index >= 0),

  content text not null,

  content_tsv tsvector
    generated always as (
      to_tsvector('simple'::regconfig, content)
    ) stored,

  embedding vector,
  embedding_model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint search_chunks_exactly_one_parent_chk
    check (num_nonnulls(item_id, action_id) = 1),

  constraint search_chunks_item_user_fk
    foreign key (item_id, user_id)
    references public.items(id, user_id)
    on delete cascade,

  constraint search_chunks_action_user_fk
    foreign key (action_id, user_id)
    references public.actions(id, user_id)
    on delete cascade
);

create unique index search_chunks_item_chunk_uidx
  on public.search_chunks (item_id, chunk_index)
  where item_id is not null;

create unique index search_chunks_action_chunk_uidx
  on public.search_chunks (action_id, chunk_index)
  where action_id is not null;

comment on table public.search_chunks is
  'ITEM 또는 Action의 검색용 Chunk 및 Embedding';

comment on column public.search_chunks.embedding is
  'Gemini Embedding 모델 확정 전까지 dimensionless vector 사용. Vector Index는 후속 Migration에서 생성';

-- ============================================================================
-- 3. Indexes
-- ============================================================================

-- connections
create index connections_user_idx
  on public.connections (user_id);

-- items
create index items_user_created_at_idx
  on public.items (user_id, created_at desc);

create index items_user_source_idx
  on public.items (user_id, source);

create index items_user_processing_status_idx
  on public.items (user_id, processing_status);

create index items_connection_user_idx
  on public.items (connection_id, user_id)
  where connection_id is not null;

create index items_content_hash_idx
  on public.items (content_hash)
  where content_hash is not null;

-- classifications
create index classifications_user_idx
  on public.classifications (user_id);

create index classifications_user_effective_topic_idx
  on public.classifications (
    user_id,
    (coalesce(user_primary_topic, ai_primary_topic))
  )
  where coalesce(user_primary_topic, ai_primary_topic) is not null;

create index classifications_user_effective_document_type_idx
  on public.classifications (
    user_id,
    (coalesce(user_document_type, ai_document_type))
  )
  where coalesce(user_document_type, ai_document_type) is not null;

create index classifications_effective_tags_gin_idx
  on public.classifications
  using gin ((coalesce(user_tags, ai_tags)));

-- actions
create index actions_user_status_idx
  on public.actions (user_id, status);

create index actions_user_action_type_idx
  on public.actions (user_id, action_type);

create index actions_user_deadline_date_idx
  on public.actions (user_id, deadline_date)
  where deadline_date is not null;

create index actions_open_deadline_idx
  on public.actions (user_id, deadline_date)
  where status = 'open'
    and deadline_status = 'confirmed'
    and deadline_date is not null;

create index actions_deadline_source_idx
  on public.actions (deadline_source_id)
  where deadline_source_id is not null;

-- action_sources
create index action_sources_user_idx
  on public.action_sources (user_id);

create index action_sources_action_history_idx
  on public.action_sources (action_id, observed_at desc);

create index action_sources_item_history_idx
  on public.action_sources (item_id, observed_at desc);

-- action_sources_one_current_per_item_uidx가 current action_id 조회의 선두 인덱스 역할도 수행한다.

-- search_chunks
create index search_chunks_user_idx
  on public.search_chunks (user_id);

create index search_chunks_user_item_idx
  on public.search_chunks (user_id, item_id)
  where item_id is not null;

create index search_chunks_user_action_idx
  on public.search_chunks (user_id, action_id)
  where action_id is not null;

create index search_chunks_content_tsv_gin_idx
  on public.search_chunks
  using gin (content_tsv);

-- HNSW / IVFFlat Vector Index는 embedding 모델과 차원 확정 후 별도 Migration에서 추가한다.

-- ============================================================================
-- 4. updated_at Trigger
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

create trigger connections_set_updated_at
before update on public.connections
for each row
execute function public.set_updated_at();

create trigger items_set_updated_at
before update on public.items
for each row
execute function public.set_updated_at();

create trigger classifications_set_updated_at
before update on public.classifications
for each row
execute function public.set_updated_at();

create trigger actions_set_updated_at
before update on public.actions
for each row
execute function public.set_updated_at();

create trigger search_chunks_set_updated_at
before update on public.search_chunks
for each row
execute function public.set_updated_at();

-- ============================================================================
-- 5. auth.users → public.users Sync
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (
    id,
    display_name
  )
  values (
    new.id,
    nullif(
      coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        split_part(coalesce(new.email, ''), '@', 1)
      ),
      ''
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

insert into public.users (
  id,
  display_name
)
select
  au.id,
  nullif(
    coalesce(
      au.raw_user_meta_data ->> 'full_name',
      au.raw_user_meta_data ->> 'name',
      split_part(coalesce(au.email, ''), '@', 1)
    ),
    ''
  )
from auth.users au
on conflict (id) do nothing;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

-- ============================================================================
-- 6. Classification Write Paths
-- ============================================================================
-- 직접 table UPDATE 대신 명시적 RPC를 사용한다.
--
-- AI:
--   upsert_ai_classification()
--   → ai_*만 갱신
--
-- 사용자:
--   set_classification_override()
--   → user_* + user_edited_at만 갱신
-- ============================================================================

create or replace function public.upsert_ai_classification(
  p_user_id uuid,
  p_item_id uuid,
  p_primary_topic text,
  p_document_type public.document_type,
  p_tags text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.items i
    where i.id = p_item_id
      and i.user_id = p_user_id
  ) then
    raise exception 'ITEM % does not belong to user %', p_item_id, p_user_id;
  end if;

  insert into public.classifications (
    user_id,
    item_id,
    ai_primary_topic,
    ai_document_type,
    ai_tags
  )
  values (
    p_user_id,
    p_item_id,
    p_primary_topic,
    p_document_type,
    coalesce(p_tags, '{}'::text[])
  )
  on conflict (item_id) do update
  set
    ai_primary_topic = excluded.ai_primary_topic,
    ai_document_type = excluded.ai_document_type,
    ai_tags = excluded.ai_tags;
end;
$$;

create or replace function public.set_classification_override(
  p_item_id uuid,
  p_primary_topic text,
  p_document_type public.document_type,
  p_tags text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.items i
    where i.id = p_item_id
      and i.user_id = v_user_id
  ) then
    raise exception 'ITEM not found';
  end if;

  insert into public.classifications (
    user_id,
    item_id,
    user_primary_topic,
    user_document_type,
    user_tags,
    user_edited_at
  )
  values (
    v_user_id,
    p_item_id,
    p_primary_topic,
    p_document_type,
    p_tags,
    now()
  )
  on conflict (item_id) do update
  set
    user_primary_topic = excluded.user_primary_topic,
    user_document_type = excluded.user_document_type,
    user_tags = excluded.user_tags,
    user_edited_at = now();
end;
$$;

-- ============================================================================
-- 7. Action Evidence Concurrency + Integrity
-- ============================================================================
-- 핵심:
-- - 같은 Action의 Evidence 변경은 부모 Action row lock으로 직렬화한다.
-- - deferred validation은 transaction 최종 상태를 검사한다.
-- - Action은 최소 1개 current Evidence를 가져야 한다.
-- - confirmed deadline은 deadline_source_id로 선택한 current Evidence와 정확히 일치해야 한다.
-- - 서로 다른 current Deadline이 2개 이상이면 resolution reason 없이는 confirmed 불가.
-- ============================================================================

create or replace function public.lock_action_evidence_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent record;
begin
  /*
   * Evidence 변경 전에 부모 Action row에 실제 UPDATE를 발생시킨다.
   *
   * 목적:
   * - READ COMMITTED: 같은 Action에 대한 Evidence 변경을 row lock으로 직렬화
   * - REPEATABLE READ: 이미 다른 transaction이 부모 row version을 변경했다면
   *   serialization failure(40001)가 발생하도록 하여 stale snapshot commit을 방지
   *
   * 40001(serialization_failure), 40P01(deadlock_detected)는
   * Application/Worker에서 전체 transaction 단위로 재시도해야 한다.
   */

  if tg_op = 'INSERT' then
    update public.actions
    set updated_at = now()
    where id = new.action_id
      and user_id = new.user_id;

    return new;
  end if;

  if tg_op = 'DELETE' then
    /*
     * ITEM 삭제처럼 Action이 살아 있는 경우에는 부모를 실제 UPDATE한다.
     * Action 자체의 ON DELETE CASCADE 과정에서 이미 부모가 현재 command에서
     * 삭제된 상태라면 UPDATE 대상이 없으므로 자연스럽게 0건 처리된다.
     */
    update public.actions
    set updated_at = now()
    where id = old.action_id
      and user_id = old.user_id;

    return old;
  end if;

  -- UPDATE: old/new 부모가 다르면 UUID 순으로 실제 UPDATE하여 내부 순서를 고정한다.
  for v_parent in
    select a.id, a.user_id
    from public.actions a
    where
      (a.id = old.action_id and a.user_id = old.user_id)
      or
      (a.id = new.action_id and a.user_id = new.user_id)
    order by a.id, a.user_id
  loop
    update public.actions
    set updated_at = now()
    where id = v_parent.id
      and user_id = v_parent.user_id;
  end loop;

  return new;
end;
$$;

create trigger action_sources_lock_parent
before insert or update or delete on public.action_sources
for each row
execute function public.lock_action_evidence_parent();

create or replace function public.assert_action_evidence(
  p_action_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline_status public.deadline_status;
  v_deadline_date date;
  v_deadline_at timestamptz;
  v_deadline_source_id uuid;
  v_resolution_reason text;
  v_deadline_resolved_at timestamptz;
  v_distinct_current_deadlines integer;
begin
  -- 부모 Action 자체를 잠가 동일 Action의 검증/변경을 직렬화한다.
  select
    a.deadline_status,
    a.deadline_date,
    a.deadline_at,
    a.deadline_source_id,
    a.deadline_resolution_reason,
    a.deadline_resolved_at
  into
    v_deadline_status,
    v_deadline_date,
    v_deadline_at,
    v_deadline_source_id,
    v_resolution_reason,
    v_deadline_resolved_at
  from public.actions a
  where a.id = p_action_id
    and a.user_id = p_user_id
  for update;

  -- Action 자체가 같은 transaction에서 삭제된 경우 검증 불필요
  if not found then
    return;
  end if;

  if not exists (
    select 1
    from public.action_sources s
    where s.action_id = p_action_id
      and s.user_id = p_user_id
      and s.is_current
  ) then
    raise exception
      'Action % must have at least one current evidence source',
      p_action_id;
  end if;

  if v_deadline_status = 'confirmed' then
    if v_deadline_source_id is null then
      raise exception
        'Confirmed deadline for action % requires deadline_source_id',
        p_action_id;
    end if;

    if not exists (
      select 1
      from public.action_sources s
      where s.id = v_deadline_source_id
        and s.action_id = p_action_id
        and s.user_id = p_user_id
        and s.is_current
        and s.observed_deadline_date = v_deadline_date
        and s.observed_deadline_at is not distinct from v_deadline_at
    ) then
      raise exception
        'Confirmed deadline for action % must match its selected current evidence source',
        p_action_id;
    end if;

    select count(*)
      into v_distinct_current_deadlines
    from (
      select distinct
        s.observed_deadline_date,
        s.observed_deadline_at
      from public.action_sources s
      where s.action_id = p_action_id
        and s.user_id = p_user_id
        and s.is_current
        and s.observed_deadline_date is not null
    ) d;

    if v_distinct_current_deadlines > 1 then
      if nullif(btrim(v_resolution_reason), '') is null then
        raise exception
          'Conflicting current deadlines for action % require an explicit resolution reason',
          p_action_id;
      end if;

      if v_deadline_resolved_at is null then
        raise exception
          'Conflicting current deadlines for action % require deadline_resolved_at',
          p_action_id;
      end if;
    else
      -- 충돌이 없는 현재 상태에서는 resolution metadata를 남기지 않는다.
      if v_resolution_reason is not null
         or v_deadline_resolved_at is not null then
        raise exception
          'Action % without a current deadline conflict must not retain resolution metadata',
          p_action_id;
      end if;
    end if;
  else
    if v_deadline_source_id is not null then
      raise exception
        'Non-confirmed action % must not retain deadline_source_id',
        p_action_id;
    end if;

    if v_resolution_reason is not null then
      raise exception
        'Non-confirmed action % must not retain deadline_resolution_reason',
        p_action_id;
    end if;

    if v_deadline_resolved_at is not null then
      raise exception
        'Non-confirmed action % must not retain deadline_resolved_at',
        p_action_id;
    end if;
  end if;
end;
$$;

create or replace function public.validate_action_evidence_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'actions' then
    perform public.assert_action_evidence(
      new.id,
      new.user_id
    );
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_action_evidence(
      new.action_id,
      new.user_id
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.assert_action_evidence(
      old.action_id,
      old.user_id
    );
    return old;
  end if;

  -- UPDATE: 기존 Action은 1회 검증하고, 부모가 실제로 바뀐 경우 새 Action도 추가 검증
  perform public.assert_action_evidence(
    old.action_id,
    old.user_id
  );

  if old.action_id is distinct from new.action_id
     or old.user_id is distinct from new.user_id then
    perform public.assert_action_evidence(
      new.action_id,
      new.user_id
    );
  end if;

  return new;
end;
$$;

create constraint trigger actions_require_evidence
after insert or update on public.actions
deferrable initially deferred
for each row
execute function public.validate_action_evidence_trigger();

create constraint trigger action_sources_preserve_evidence
after insert or update or delete on public.action_sources
deferrable initially deferred
for each row
execute function public.validate_action_evidence_trigger();

-- ============================================================================
-- 8. Row Level Security
-- ============================================================================

alter table public.users enable row level security;
alter table public.connections enable row level security;
alter table public.items enable row level security;
alter table public.classifications enable row level security;
alter table public.actions enable row level security;
alter table public.action_sources enable row level security;
alter table public.search_chunks enable row level security;

create policy users_select_own
on public.users
for select
to authenticated
using (id = auth.uid());

create policy users_update_own_profile
on public.users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy connections_select_own
on public.connections
for select
to authenticated
using (user_id = auth.uid());

create policy items_select_own
on public.items
for select
to authenticated
using (user_id = auth.uid());

create policy classifications_select_own
on public.classifications
for select
to authenticated
using (user_id = auth.uid());

create policy actions_select_own
on public.actions
for select
to authenticated
using (user_id = auth.uid());

create policy action_sources_select_own
on public.action_sources
for select
to authenticated
using (user_id = auth.uid());

create policy search_chunks_select_own
on public.search_chunks
for select
to authenticated
using (user_id = auth.uid());

-- ============================================================================
-- 9. Privilege Hardening
-- ============================================================================
-- 모든 client/service_role table 권한을 먼저 회수한 뒤 최소 권한만 재부여한다.
-- service_role에도 TRUNCATE를 부여하지 않는다.
-- ============================================================================

revoke all privileges on table public.users
  from public, anon, authenticated, service_role;

revoke all privileges on table public.connections
  from public, anon, authenticated, service_role;

revoke all privileges on table public.items
  from public, anon, authenticated, service_role;

revoke all privileges on table public.classifications
  from public, anon, authenticated, service_role;

revoke all privileges on table public.actions
  from public, anon, authenticated, service_role;

revoke all privileges on table public.action_sources
  from public, anon, authenticated, service_role;

revoke all privileges on table public.search_chunks
  from public, anon, authenticated, service_role;

-- authenticated
grant select on table public.users to authenticated;
grant update (display_name, timezone) on table public.users to authenticated;

grant select on table public.connections to authenticated;
grant select on table public.items to authenticated;
grant select on table public.classifications to authenticated;
grant select on table public.actions to authenticated;
grant select on table public.action_sources to authenticated;
grant select on table public.search_chunks to authenticated;

-- service_role
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.connections to service_role;
grant select, insert, update, delete on table public.items to service_role;

-- classifications는 직접 변경 금지.
-- AI는 upsert_ai_classification(), 사용자는 set_classification_override()만 사용.
grant select on table public.classifications to service_role;

grant select, insert, update, delete on table public.actions to service_role;
grant select, insert, update, delete on table public.action_sources to service_role;
grant select, insert, update, delete on table public.search_chunks to service_role;

-- ============================================================================
-- 10. Function Privileges
-- ============================================================================

revoke all on function public.set_updated_at()
  from public, anon, authenticated, service_role;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated, service_role;

revoke all on function public.upsert_ai_classification(
  uuid, uuid, text, public.document_type, text[]
)
  from public, anon, authenticated, service_role;

revoke all on function public.set_classification_override(
  uuid, text, public.document_type, text[]
)
  from public, anon, authenticated, service_role;

revoke all on function public.lock_action_evidence_parent()
  from public, anon, authenticated, service_role;

revoke all on function public.assert_action_evidence(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.validate_action_evidence_trigger()
  from public, anon, authenticated, service_role;

grant execute on function public.upsert_ai_classification(
  uuid, uuid, text, public.document_type, text[]
)
  to service_role;

grant execute on function public.set_classification_override(
  uuid, text, public.document_type, text[]
)
  to authenticated;

-- Trigger helper functions는 직접 호출 권한을 외부 역할에 부여하지 않는다.
-- CREATE TRIGGER 시점의 owner 권한으로 연결되며 trigger를 통해서만 실행한다.

-- ============================================================================
-- 11. Final Notes / Still Open
-- ============================================================================
-- 이번 Migration에서 확정하지 않는 항목:
--
-- 1) Google OAuth token 저장 구조
-- 2) Gemini Embedding 모델
-- 3) vector dimension
-- 4) HNSW / IVFFlat Vector Index
-- 5) Supabase Storage Bucket / Storage RLS
-- 6) Search Ranking 가중치
-- 7) 사용자 Action 완료/수정용 API/RPC 상세 계약
--
-- Classification:
-- - AI는 upsert_ai_classification()으로 ai_*만 갱신한다.
-- - 사용자는 set_classification_override()로 user_*만 갱신한다.
-- - effective 값은 COALESCE(user_*, ai_*) 원칙을 사용한다.
--
-- Action / Evidence:
-- - Action + current action_sources는 같은 transaction에서 생성/변경한다.
-- - Evidence 변경 전 부모 Action row에 실제 UPDATE를 발생시켜 동시 변경을 직렬화한다.
-- - 40001(serialization_failure), 40P01(deadlock_detected)는 전체 transaction 재시도 대상이다.
-- - confirmed deadline은 deadline_source_id의 current Evidence와 정확히 일치해야 한다.
-- - current Evidence 간 Deadline 충돌이 있으면 reason + deadline_resolved_at 없이는 confirmed 불가.
-- - deadline_resolved_at은 '현재 Deadline 충돌을 해결한 시각'이며 과거 감사 이력 필드가 아니다.
-- - 충돌이 없거나 deadline_status가 confirmed가 아니면 resolution metadata는 NULL이어야 한다.
-- - 최신성이 불명확한 경우 Application/API는 needs_review를 사용한다.
-- - Source 수정 공지는 기존 history를 is_current=false로 남기고 새 row를 추가한다.
--
-- Source identity:
-- - Gmail: connection + message_id
-- - Drive: connection + file_id
-- - Calendar: connection + calendar_id + event_id
-- - status='connected'인 connection은 provider_account_id가 반드시 존재해야 한다.
-- - 같은 Google 계정 재연결은 provider_account_id로 기존 connection을 찾아 재활성화한다.
--
-- P0 migration validation:
-- - Auth 사용자 전체 삭제 cascade는 23503 foreign_key_violation 없이 완료되어야 한다.
-- - confirmed Action + selected Evidence + 복수 ITEM Evidence 조합에서도 전체 삭제가 성공해야 한다.
-- - 같은 transaction에서 Action을 먼저 수정한 뒤 사용자를 삭제하는 경우도 검증한다.
--
-- Vector Search:
-- - embedding은 dimensionless vector로만 준비한다.
-- - 모델/차원 확정 후 별도 Migration에서 vector(n) + HNSW/IVFFlat을 적용한다.
-- ============================================================================

commit;
