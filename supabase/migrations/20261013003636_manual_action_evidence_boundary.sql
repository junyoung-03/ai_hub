-- Existing Actions remain source-backed; only the authenticated server create path opts into manual.
alter table public.actions add column origin text not null default 'source'
  constraint actions_origin_check check (origin in ('source', 'manual'));
comment on column public.actions.origin is 'Immutable origin: source Evidence or owner-entered manual Action';

create function public.guard_action_origin() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.origin is distinct from old.origin then
    raise exception 'Action origin is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_action_origin() from public, anon, authenticated;
create trigger actions_origin_immutable before update of origin on public.actions
for each row execute function public.guard_action_origin();

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
  v_origin text;
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
    a.origin,
    a.deadline_status,
    a.deadline_date,
    a.deadline_at,
    a.deadline_source_id,
    a.deadline_resolution_reason,
    a.deadline_resolved_at
  into
    v_origin,
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

  -- Owner-entered dates do not claim an extracted evidence source.
  if v_origin = 'manual' then
    if v_deadline_source_id is not null or v_resolution_reason is not null or v_deadline_resolved_at is not null
       or exists (select 1 from public.action_sources s where s.action_id = p_action_id and s.user_id = p_user_id) then
      raise exception 'Manual Action % must not contain source evidence', p_action_id;
    end if;
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
-- Keep existing evidence trigger, grants, RLS and source validation unchanged.
