-- AI Hub DB Optimization Migration v0.1
-- Purpose:
--   1) Add covering indexes for composite foreign keys flagged by Supabase Advisor.
--   2) Optimize RLS auth.uid() evaluation by wrapping it in SELECT so PostgreSQL can use an initPlan.
-- Scope:
--   - No permission model changes.
--   - No SECURITY DEFINER changes.
--   - No data model changes.

begin;

-- =========================================================
-- 1. Composite FK covering indexes
-- =========================================================

create index if not exists action_sources_action_user_idx
  on public.action_sources (action_id, user_id);

create index if not exists action_sources_item_user_idx
  on public.action_sources (item_id, user_id);

create index if not exists classifications_item_user_idx
  on public.classifications (item_id, user_id);

create index if not exists search_chunks_action_user_fk_idx
  on public.search_chunks (action_id, user_id)
  where action_id is not null;

create index if not exists search_chunks_item_user_fk_idx
  on public.search_chunks (item_id, user_id)
  where item_id is not null;

-- =========================================================
-- 2. RLS auth.uid() initPlan optimization
-- =========================================================

alter policy users_select_own
  on public.users
  using (id = (select auth.uid()));

alter policy users_update_own_profile
  on public.users
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy connections_select_own
  on public.connections
  using (user_id = (select auth.uid()));

alter policy items_select_own
  on public.items
  using (user_id = (select auth.uid()));

alter policy classifications_select_own
  on public.classifications
  using (user_id = (select auth.uid()));

alter policy actions_select_own
  on public.actions
  using (user_id = (select auth.uid()));

alter policy action_sources_select_own
  on public.action_sources
  using (user_id = (select auth.uid()));

alter policy search_chunks_select_own
  on public.search_chunks
  using (user_id = (select auth.uid()));

commit;
