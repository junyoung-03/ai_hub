-- Append-only status history; never store provider responses, text or credentials.
begin;
create table private.analysis_diagnostic_history (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.users(id) on delete cascade,
 item_id uuid not null,
 source text not null check (source in ('gmail_worker','item')),
 state text not null check (state in ('pending','running','retry','complete','failed')),
 attempt integer check (attempt between 0 and 5),
 error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 occurred_at timestamptz not null default clock_timestamp()
);
alter table private.analysis_diagnostic_history enable row level security;
revoke all on private.analysis_diagnostic_history from public,anon,authenticated,service_role;
create index analysis_diagnostic_owner_recent on private.analysis_diagnostic_history(user_id,occurred_at desc,id desc);

create function private.log_gmail_analysis_state() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.state is not distinct from old.state and new.attempts is not distinct from old.attempts
    and new.error_code is not distinct from old.error_code then return new; end if;
 insert into private.analysis_diagnostic_history(user_id,item_id,source,state,attempt,error_code)
 values(new.user_id,new.item_id,'gmail_worker',new.state,new.attempts,
   case when new.error_code ~ '^[A-Z][A-Z0-9_]{0,63}$' then new.error_code else null end);
 return new;
end $$;
create trigger gmail_analysis_state_history after insert or update on private.gmail_analysis_jobs
for each row execute function private.log_gmail_analysis_state();
revoke all on function private.log_gmail_analysis_state() from public,anon,authenticated,service_role;

create function private.log_item_analysis_failure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.processing_status='failed' and new.processing_error ~ '^(ANALYSIS_|GEMINI_)[A-Z0-9_]{1,55}$'
   and (new.processing_status is distinct from old.processing_status or new.processing_error is distinct from old.processing_error) then
  insert into private.analysis_diagnostic_history(user_id,item_id,source,state,error_code)
  values(new.user_id,new.id,'item','failed',new.processing_error);
 end if;
 return new;
end $$;
create trigger item_analysis_failure_history after update of processing_status,processing_error on public.items
for each row execute function private.log_item_analysis_failure();
revoke all on function private.log_item_analysis_failure() from public,anon,authenticated,service_role;

create function public.analysis_diagnostics(p_item_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); result jsonb;
begin
 if owner_id is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc),'[]'::jsonb) into result
 from (select item_id,source,state,attempt,error_code,occurred_at,id from private.analysis_diagnostic_history
  where user_id=owner_id and (p_item_id is null or item_id=p_item_id) order by occurred_at desc,id desc limit 100) e;
 return result;
end $$;
revoke all on function public.analysis_diagnostics(uuid) from public,anon,authenticated,service_role;
grant execute on function public.analysis_diagnostics(uuid) to authenticated;
commit;
