-- Opt-in only. No schedules, mail collection, backfill or provider calls on migration.
begin;
create table private.gmail_automation_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 owner_id uuid references public.users(id) on delete cascade,
 sync_token uuid, sync_lease_until timestamptz,
 check(not enabled or owner_id is not null)
);
insert into private.gmail_automation_config(singleton) values(true);
alter table private.gmail_automation_config enable row level security;
revoke all on private.gmail_automation_config from public,anon,authenticated,service_role;

create table private.gmail_sync_history (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.users(id) on delete cascade,
 state text not null check(state in ('running','complete','partial','failed','interrupted')),
 error_code text check(error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 collected_count integer, created_count integer, updated_count integer, failed_count integer,
 occurred_at timestamptz not null default clock_timestamp()
);
alter table private.gmail_sync_history enable row level security;
revoke all on private.gmail_sync_history from public,anon,authenticated,service_role;
create index gmail_sync_history_owner on private.gmail_sync_history(user_id,occurred_at desc);

-- pg_net response rows expire; retain only request status, never response bodies or headers.
create table private.gmail_dispatch_history (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.users(id) on delete cascade,
 kind text not null check(kind in ('sync','analysis')),
 request_id bigint not null unique,
 state text not null default 'queued' check(state in ('queued','responded','timed_out','response_expired')),
 http_status integer, occurred_at timestamptz not null default clock_timestamp(), completed_at timestamptz
);
alter table private.gmail_dispatch_history enable row level security;
revoke all on private.gmail_dispatch_history from public,anon,authenticated,service_role;
create index gmail_dispatch_history_owner on private.gmail_dispatch_history(user_id,occurred_at desc);

create function public.gmail_automation_state() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'owner',owner_id) from private.gmail_automation_config where singleton
$$;
revoke all on function public.gmail_automation_state() from public,anon,authenticated,service_role;
grant execute on function public.gmail_automation_state() to service_role;

-- A 6-minute lease outlives the 300-second request; old attempts cannot finish a new lease.
create function public.claim_gmail_sync(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.gmail_automation_config%rowtype; tok uuid;
begin
 select * into strict c from private.gmail_automation_config where singleton for update;
 if not c.enabled or c.owner_id is distinct from p_owner then return null; end if;
 if c.sync_token is not null and c.sync_lease_until>clock_timestamp() then return null; end if;
 if c.sync_token is not null then
  insert into private.gmail_sync_history(user_id,state,error_code) values(p_owner,'interrupted','SYNC_WORKER_INTERRUPTED');
 end if;
 tok:=gen_random_uuid();
 update private.gmail_automation_config set sync_token=tok,sync_lease_until=clock_timestamp()+interval '6 minutes' where singleton;
 insert into private.gmail_sync_history(user_id,state) values(p_owner,'running');
 return jsonb_build_object('token',tok);
end $$;
revoke all on function public.claim_gmail_sync(uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_gmail_sync(uuid) to service_role;

create function public.finish_gmail_sync(p_owner uuid,p_token uuid,p_state text,p_error_code text,p_counts jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.gmail_automation_config%rowtype;
begin
 if p_state not in ('complete','partial','failed') or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$') then raise exception 'Invalid result'; end if;
 select * into strict c from private.gmail_automation_config where singleton for update;
 if c.owner_id is distinct from p_owner or c.sync_token is distinct from p_token or c.sync_lease_until<=clock_timestamp() then return false; end if;
 insert into private.gmail_sync_history(user_id,state,error_code,collected_count,created_count,updated_count,failed_count)
 values(p_owner,p_state,p_error_code,coalesce((p_counts->>'collected_count')::int,0),coalesce((p_counts->>'created_count')::int,0),
  coalesce((p_counts->>'updated_count')::int,0),coalesce((p_counts->>'failed_count')::int,0));
 update private.gmail_automation_config set sync_token=null,sync_lease_until=null where singleton;
 return true;
end $$;
revoke all on function public.finish_gmail_sync(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finish_gmail_sync(uuid,uuid,text,text,jsonb) to service_role;

-- Preserve the existing project-wide 5/day and 60-second budget. No unlimited provider calls.
create function public.claim_gmail_automatic_job(p_allowed_users uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.gmail_free_budget%rowtype; c private.gmail_automation_config%rowtype; picked jsonb;
 today date:=(clock_timestamp() at time zone 'UTC')::date;
begin
 select * into strict b from private.gmail_free_budget where singleton for update;
 select * into strict c from private.gmail_automation_config where singleton;
 if not c.enabled or cardinality(p_allowed_users) is distinct from 1 or p_allowed_users[1] is distinct from c.owner_id then return null; end if;
 if b.next_at>clock_timestamp() then return null; end if;
 if b.budget_day<>today then b.reserved:=0; end if;
 if b.reserved>=5 then return null; end if;
 picked:=public.claim_gmail_analysis_job(p_allowed_users);
 if picked is not null then
  update private.gmail_free_budget set budget_day=today,reserved=b.reserved+1,next_at=clock_timestamp()+interval '60 seconds' where singleton;
  perform private.schedule_gmail_analysis_lease_cleanup((picked->>'userId')::uuid,(picked->>'itemId')::uuid);
 end if;
 return picked;
end $$;
revoke all on function public.claim_gmail_automatic_job(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.claim_gmail_automatic_job(uuid[]) to service_role;

-- Uses the existing secret and short-lived request signature. Does not schedule itself.
create function private.dispatch_gmail_automatic(p_kind text) returns bigint
language plpgsql security definer set search_path='' as $$
declare c private.gmail_automation_config%rowtype; configured_owner uuid; secret text; base_url text; path text; stamp text; signature text; request_id bigint;
begin
 if p_kind not in ('sync','analysis') then raise exception 'Invalid job'; end if;
 if to_regclass('net._http_response') is not null then
  update private.gmail_dispatch_history h set state=case when r.timed_out then 'timed_out' else 'responded' end,
   http_status=r.status_code,completed_at=clock_timestamp()
  from net._http_response r where h.state='queued' and h.request_id=r.id;
 end if;
 update private.gmail_dispatch_history set state='response_expired',completed_at=clock_timestamp()
  where state='queued' and occurred_at<clock_timestamp()-interval '10 minutes';
 select * into strict c from private.gmail_automation_config where singleton;
 if not c.enabled then return null; end if;
 begin select decrypted_secret::uuid into configured_owner from vault.decrypted_secrets where name='etc_gmail_analysis_user';
 exception when invalid_text_representation then return null; end;
 if configured_owner is distinct from c.owner_id then return null; end if;
 if p_kind='analysis' and (not exists(select 1 from private.gmail_analysis_jobs where user_id=c.owner_id
   and ((state in ('pending','retry') and available_at<=clock_timestamp()) or (state='running' and lease_until<=clock_timestamp())))
   or exists(select 1 from private.gmail_free_budget where (budget_day=(clock_timestamp() at time zone 'UTC')::date and reserved>=5) or next_at>clock_timestamp())) then return null; end if;
 select decrypted_secret into base_url from vault.decrypted_secrets where name='etc_gmail_analysis_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='etc_gmail_analysis_secret';
 if base_url is distinct from 'https://ai-hub-one-ebon.vercel.app/api/internal/gmail-analysis' or coalesce(length(secret),0)<32 then raise exception 'Scheduler configuration missing'; end if;
 path:=case when p_kind='sync' then '/api/internal/gmail-sync' else '/api/internal/gmail-analysis' end;
 stamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 signature:=encode(extensions.hmac(E'POST\n'||path||E'\n'||stamp,secret,'sha256'),'hex');
 request_id:=net.http_post(url:='https://ai-hub-one-ebon.vercel.app'||path,body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','x-etc-timestamp',stamp,'x-etc-signature',signature),timeout_milliseconds:=case when p_kind='sync' then 300000 else 120000 end);
 insert into private.gmail_dispatch_history(user_id,kind,request_id) values(c.owner_id,p_kind,request_id);
 return request_id;
end $$;
revoke all on function private.dispatch_gmail_automatic(text) from public,anon,authenticated,service_role;

create function public.gmail_automatic_available() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and owner_id=auth.uid() from private.gmail_automation_config where singleton),false)
$$;
revoke all on function public.gmail_automatic_available() from public,anon,authenticated,service_role;
grant execute on function public.gmail_automatic_available() to authenticated;

create function public.request_automatic_gmail_analysis(p_item_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); i public.items%rowtype; j private.gmail_analysis_jobs%rowtype;
begin
 if owner_id is null or not public.gmail_automatic_available() then raise exception 'Forbidden' using errcode='42501'; end if;
 if not exists(select 1 from cron.job where jobname='etc-gmail-auto-analysis' and active) then raise exception 'Worker schedule paused' using errcode='PT503'; end if;
 perform id from public.users where id=owner_id for no key update;
 select * into i from public.items where id=p_item_id and user_id=owner_id for update;
 if not found then raise exception 'Forbidden' using errcode='42501'; end if;
 if i.source<>'gmail' or i.format<>'email' or nullif(btrim(i.content_text),'') is null or length(i.content_text)>200000 then raise exception 'Invalid analysis input' using errcode='22023'; end if;
 perform private.expire_gmail_analysis_lease(owner_id,p_item_id);
 select * into i from public.items where id=p_item_id and user_id=owner_id;
 select * into j from private.gmail_analysis_jobs where item_id=p_item_id and user_id=owner_id for update;
 if i.processing_status='analyzing' or j.state='running' then return jsonb_build_object('state','running','processingStatus',i.processing_status); end if;
 if j.state='complete' and j.revision=md5(i.content_text||coalesce(i.content_hash,'')) and i.processing_status in ('indexing','completed') then
  return jsonb_build_object('state','complete','processingStatus',i.processing_status);
 end if;
 perform public.enqueue_gmail_analysis(owner_id,array[p_item_id]);
 select * into j from private.gmail_analysis_jobs where item_id=p_item_id and user_id=owner_id;
 if not found then raise exception 'Invalid analysis input' using errcode='22023'; end if;
 if j.state='pending' then update public.items set processing_status='queued',processing_error=null where id=p_item_id and user_id=owner_id returning * into i; end if;
 return jsonb_build_object('state',j.state,'processingStatus',i.processing_status);
end $$;
revoke all on function public.request_automatic_gmail_analysis(uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_automatic_gmail_analysis(uuid) to authenticated;

create or replace function public.gmail_analysis_job_status(p_item_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); result jsonb; target_user uuid; target_items uuid[]; schedule_active boolean; budget_available boolean; automatic boolean;
begin
 if owner_id is null or coalesce(cardinality(p_item_ids),0) not between 1 and 100 then raise exception 'Forbidden' using errcode='42501'; end if;
 begin
  select decrypted_secret::uuid into target_user from vault.decrypted_secrets where name='etc_gmail_analysis_user';
  select string_to_array(decrypted_secret,',')::uuid[] into target_items from vault.decrypted_secrets where name='etc_gmail_analysis_items';
 exception when invalid_text_representation then target_user:=null; target_items:=null; end;
 automatic:=public.gmail_automatic_available() and target_user=owner_id;
 select exists(select 1 from cron.job where jobname=case when automatic then 'etc-gmail-auto-analysis' else 'etc-gmail-demo' end and active) into schedule_active;
 select not exists(select 1 from private.gmail_free_budget where budget_day=(clock_timestamp() at time zone 'UTC')::date and reserved>=5) into budget_available;
 select coalesce(jsonb_agg(jsonb_build_object('itemId',j.item_id,'state',j.state,'leaseUntil',j.lease_until,
  'availableAt',j.available_at,'processingStatus',i.processing_status,'scheduleActive',schedule_active,
  'waitingForBudget',coalesce(automatic and schedule_active and not budget_available,false),
  'schedulerAvailable',coalesce(schedule_active and budget_available and target_user=owner_id
   and (automatic or (cardinality(target_items) between 1 and 3 and j.item_id=any(target_items))),false)) order by j.item_id),'[]'::jsonb) into result
 from private.gmail_analysis_jobs j join public.items i on i.id=j.item_id and i.user_id=j.user_id
 where j.user_id=owner_id and j.item_id=any(p_item_ids);
 return result;
end $$;
commit;
