-- REVIEW ONLY: do not apply without approval. No historic corpus backfill.
begin;
create table private.gmail_analysis_jobs (
  item_id uuid primary key,
  user_id uuid not null,
  revision text not null,
  state text not null default 'pending' check(state in ('pending','running','retry','complete','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  available_at timestamptz not null default now(),
  token uuid, lease_until timestamptz, snapshot_updated_at timestamptz,
  error_code text, updated_at timestamptz not null default now(),
  foreign key(item_id,user_id) references public.items(id,user_id) on delete cascade
);
create index gmail_analysis_due on private.gmail_analysis_jobs(available_at,item_id)
where state in ('pending','retry','running');
alter table private.gmail_analysis_jobs enable row level security;
revoke all on private.gmail_analysis_jobs from public,anon,authenticated,service_role;

-- Source text revision only; progress/status/metadata changes cannot requeue a job.
create function private.queue_gmail_analysis() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.content_text is not distinct from old.content_text and new.content_hash is not distinct from old.content_hash then return new; end if;
 end if;
 if new.source='gmail' and new.format='email' and nullif(btrim(new.content_text),'') is not null
    and length(new.content_text)<=200000 then
  insert into private.gmail_analysis_jobs(item_id,user_id,revision)
  values(new.id,new.user_id,md5(new.content_text || coalesce(new.content_hash,'')))
  on conflict(item_id) do update set revision=excluded.revision,state='pending',attempts=0,
    available_at=clock_timestamp(),token=null,lease_until=null,snapshot_updated_at=null,error_code=null,updated_at=clock_timestamp()
  where gmail_analysis_jobs.revision is distinct from excluded.revision;
 end if;
 return new;
end $$;
create trigger gmail_analysis_enqueue after insert or update of content_text,content_hash on public.items
for each row execute function private.queue_gmail_analysis();
revoke all on function private.queue_gmail_analysis() from public,anon,authenticated,service_role;

-- Browser retry is owner-scoped. Service caller must also supply an explicit owner.
create function public.enqueue_gmail_analysis(p_user_id uuid,p_item_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_user_id is null or (auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id)
    or coalesce(cardinality(p_item_ids),0) not between 1 and 100 then raise exception 'Forbidden' using errcode='42501'; end if;
 -- Use the same user -> ITEM -> job lock order as persistence and worker functions.
 perform id from public.users where id=p_user_id for no key update;
 perform id from public.items where user_id=p_user_id and id=any(p_item_ids) order by id for update;
 insert into private.gmail_analysis_jobs(item_id,user_id,revision)
 select id,user_id,md5(content_text || coalesce(content_hash,'')) from public.items
 where user_id=p_user_id and id=any(p_item_ids) and source='gmail' and format='email'
 and nullif(btrim(content_text),'') is not null and length(content_text)<=200000
 on conflict(item_id) do update set state='pending',attempts=0,available_at=clock_timestamp(),error_code=null,
   revision=excluded.revision,token=null,lease_until=null,updated_at=clock_timestamp()
 where gmail_analysis_jobs.state in ('failed','complete') or gmail_analysis_jobs.revision is distinct from excluded.revision;
 get diagnostics n=row_count; return n;
end $$;

create function public.claim_gmail_analysis_job(p_allowed_users uuid[],p_item_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; i public.items%rowtype; j private.gmail_analysis_jobs%rowtype; stamp timestamptz;
begin
 if coalesce(cardinality(p_allowed_users),0) not between 1 and 100 then raise exception 'Explicit owner scope required'; end if;
 for candidate in select item_id,user_id from private.gmail_analysis_jobs
  where user_id=any(p_allowed_users) and (p_item_ids is null or item_id=any(p_item_ids)) and ((state in ('pending','retry') and available_at<=clock_timestamp())
     or (state='running' and lease_until<=clock_timestamp()))
  order by available_at,item_id limit 100 loop
  perform id from public.users where id=candidate.user_id for no key update skip locked;
  if not found then continue; end if;
  select * into i from public.items where id=candidate.item_id and user_id=candidate.user_id for update skip locked;
  if not found then continue; end if;
  select * into j from private.gmail_analysis_jobs where item_id=i.id for update skip locked;
  if not found or not ((j.state in ('pending','retry') and j.available_at<=clock_timestamp())
     or (j.state='running' and j.lease_until<=clock_timestamp())) then continue; end if;
  if j.attempts>=5 or i.source<>'gmail' or i.format<>'email' or nullif(btrim(i.content_text),'') is null then
   update private.gmail_analysis_jobs set state='failed',error_code=case when j.attempts>=5 then 'ATTEMPTS_EXHAUSTED' else 'INVALID_INPUT' end,
    token=null,lease_until=null,updated_at=clock_timestamp() where item_id=i.id;
   if i.processing_status='analyzing' then
    update public.items set processing_status='failed',processing_error=case when j.attempts>=5 then 'ANALYSIS_ATTEMPTS_EXHAUSTED' else 'INVALID_ANALYSIS_INPUT' end where id=i.id;
   end if;
   continue;
  end if;
  update public.items set processing_status='analyzing',processing_error=null where id=i.id returning updated_at into stamp;
  update private.gmail_analysis_jobs set state='running',attempts=attempts+1,token=gen_random_uuid(),
    lease_until=clock_timestamp()+interval '180 seconds',snapshot_updated_at=stamp,updated_at=clock_timestamp()
    where item_id=i.id returning * into j;
  return jsonb_build_object('itemId',j.item_id,'userId',j.user_id,'token',j.token,'attempt',j.attempts);
 end loop;
 return null;
end $$;

-- Fenced transaction: validate lease/snapshot THEN invoke the unchanged analysis storage RPC.
create function public.finish_gmail_analysis_job(p_user_id uuid,p_item_id uuid,p_token uuid,
 p_analysis jsonb,p_model text,p_fingerprint text,p_error_code text,p_retry_seconds integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.items%rowtype; j private.gmail_analysis_jobs%rowtype; saved jsonb;
begin
 perform id from public.users where id=p_user_id for no key update;
 select * into i from public.items where id=p_item_id and user_id=p_user_id for update;
 if not found then raise exception 'Stale attempt' using errcode='PT409'; end if;
 select * into j from private.gmail_analysis_jobs where item_id=i.id and user_id=p_user_id for update;
 if not found or j.state<>'running' or j.token is distinct from p_token or j.lease_until<=clock_timestamp() then
  raise exception 'Stale attempt' using errcode='PT409'; end if;
 if i.updated_at is distinct from j.snapshot_updated_at or j.revision is distinct from md5(i.content_text || coalesce(i.content_hash,'')) then
  update private.gmail_analysis_jobs set state='pending',available_at=clock_timestamp(),token=null,lease_until=null,
    updated_at=clock_timestamp() where item_id=i.id;
  return jsonb_build_object('state','pending','stale',true);
 end if;
 if p_error_code is null then
  if p_analysis->>'schemaVersion' is distinct from '0.2' then raise exception 'Worker schema must remain 0.2'; end if;
  saved:=public.persist_gmail_item_analysis(p_user_id,i.id,i.content_text,i.content_hash,p_analysis,p_model,p_fingerprint);
  -- The existing RPC can return a cached no-op; do not leave the claim's analyzing status behind.
  update public.items set processing_status='indexing',processing_error=null where id=i.id and processing_status='analyzing';
  update private.gmail_analysis_jobs set state='complete',token=null,lease_until=null,error_code=null,updated_at=clock_timestamp() where item_id=i.id;
  return jsonb_build_object('state','complete','result',saved);
 end if;
 if p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then raise exception 'Invalid error code'; end if;
 update public.items set processing_status='failed',processing_error=p_error_code where id=i.id;
 update private.gmail_analysis_jobs set state=case when p_retry_seconds is not null and attempts<5 then 'retry' else 'failed' end,
  available_at=clock_timestamp()+make_interval(secs=>least(86400,greatest(30,coalesce(p_retry_seconds,60)))),
  token=null,lease_until=null,error_code=p_error_code,updated_at=clock_timestamp() where item_id=i.id returning * into j;
 return jsonb_build_object('state',j.state);
end $$;
revoke all on function public.enqueue_gmail_analysis(uuid,uuid[]), public.claim_gmail_analysis_job(uuid[],uuid[]),
 public.finish_gmail_analysis_job(uuid,uuid,uuid,jsonb,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_gmail_analysis(uuid,uuid[]) to authenticated,service_role;
grant execute on function public.claim_gmail_analysis_job(uuid[],uuid[]),
 public.finish_gmail_analysis_job(uuid,uuid,uuid,jsonb,text,text,text,integer) to service_role;

-- Demo free-tier guard: global (API project) budget, not per process/instance.
-- Budget counts reservations, including failed/crashed/cached attempts, conservatively.
create table private.gmail_free_budget (
 singleton boolean primary key default true check(singleton),
 budget_day date not null, reserved integer not null check(reserved between 0 and 5),
 next_at timestamptz not null
);
alter table private.gmail_free_budget enable row level security;
revoke all on private.gmail_free_budget from public,anon,authenticated,service_role;
insert into private.gmail_free_budget values(true,(clock_timestamp() at time zone 'UTC')::date,0,clock_timestamp());
create function public.claim_free_gmail_analysis_job(p_allowed_users uuid[],p_item_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.gmail_free_budget%rowtype; picked jsonb; today date := (clock_timestamp() at time zone 'UTC')::date;
begin
 if cardinality(p_allowed_users) is distinct from 1 or coalesce(cardinality(p_item_ids),0) not between 1 and 3
 then raise exception 'Explicit demo scope required'; end if;
 select * into strict b from private.gmail_free_budget where singleton for update;
 if b.next_at>clock_timestamp() then return null; end if;
 if b.budget_day<>today then b.reserved:=0; end if;
 if b.reserved>=5 then return null; end if;
 picked:=public.claim_gmail_analysis_job(p_allowed_users,p_item_ids);
 if picked is not null then
  update private.gmail_free_budget set budget_day=today,reserved=b.reserved+1,
   next_at=clock_timestamp()+interval '60 seconds' where singleton;
 end if;
 return picked;
end $$;
revoke all on function public.claim_free_gmail_analysis_job(uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.claim_free_gmail_analysis_job(uuid[],uuid[]) to service_role;

commit;
