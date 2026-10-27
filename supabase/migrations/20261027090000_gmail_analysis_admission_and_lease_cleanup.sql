-- Free demo reliability only: no provider calls, broader scope, or historical enqueue.
begin;

-- Reconciliation does not reserve quota. The existing user -> ITEM -> job lock order
-- fences an old worker before marking only its active processing state interrupted.
create function private.expire_gmail_analysis_lease(p_user_id uuid,p_item_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare i public.items%rowtype; j private.gmail_analysis_jobs%rowtype;
begin
 perform id from public.users where id=p_user_id for no key update;
 select * into i from public.items where id=p_item_id and user_id=p_user_id for update;
 if not found then return false; end if;
 select * into j from private.gmail_analysis_jobs where item_id=p_item_id and user_id=p_user_id for update;
 if not found or j.state<>'running' or j.lease_until>clock_timestamp() then return false; end if;
 update private.gmail_analysis_jobs set state=case when attempts<5 then 'retry' else 'failed' end,
  token=null,lease_until=null,snapshot_updated_at=null,available_at=clock_timestamp(),
  error_code='ANALYSIS_WORKER_INTERRUPTED',updated_at=clock_timestamp() where item_id=p_item_id;
 update public.items set processing_status='failed',processing_error='ANALYSIS_WORKER_INTERRUPTED'
  where id=p_item_id and user_id=p_user_id and processing_status='analyzing'
   and updated_at=j.snapshot_updated_at and md5(content_text||coalesce(content_hash,''))=j.revision;
 return true;
end $$;

-- A separate per-ITEM DB-only schedule survives the processing demo's 15-minute
-- stop and exhausted budget. It removes itself after finish, expiry, or deletion.
create function private.cleanup_gmail_analysis_lease(p_user_id uuid,p_item_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare schedule_name text := 'etc-gmail-lease-'||p_item_id::text;
begin
 perform private.expire_gmail_analysis_lease(p_user_id,p_item_id);
 if not exists(select 1 from private.gmail_analysis_jobs where user_id=p_user_id and item_id=p_item_id and state='running') then
  if exists(select 1 from cron.job where jobname=schedule_name) then perform cron.unschedule(schedule_name); end if;
 end if;
end $$;

create function private.schedule_gmail_analysis_lease_cleanup(p_user_id uuid,p_item_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform cron.schedule('etc-gmail-lease-'||p_item_id::text,'* * * * *',
  format('select private.cleanup_gmail_analysis_lease(%L::uuid,%L::uuid);',p_user_id,p_item_id));
end $$;
revoke all on function private.expire_gmail_analysis_lease(uuid,uuid),private.cleanup_gmail_analysis_lease(uuid,uuid),
 private.schedule_gmail_analysis_lease_cleanup(uuid,uuid) from public,anon,authenticated,service_role;

-- A read-only owner-scoped projection for detail/list polling. Never expose tokens.
create function public.gmail_analysis_job_status(p_item_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); result jsonb; target_user uuid; target_items uuid[];
 schedule_active boolean; budget_available boolean;
begin
 if owner_id is null or coalesce(cardinality(p_item_ids),0) not between 1 and 100 then raise exception 'Forbidden' using errcode='42501'; end if;
 begin
  select decrypted_secret::uuid into target_user from vault.decrypted_secrets where name='etc_gmail_analysis_user';
  select string_to_array(decrypted_secret,',')::uuid[] into target_items from vault.decrypted_secrets where name='etc_gmail_analysis_items';
 exception when invalid_text_representation then target_user:=null; target_items:=null; end;
 select exists(select 1 from cron.job where jobname='etc-gmail-demo' and active) into schedule_active;
 select not exists(select 1 from private.gmail_free_budget where budget_day=(clock_timestamp() at time zone 'UTC')::date and reserved>=5) into budget_available;
 select coalesce(jsonb_agg(jsonb_build_object('itemId',j.item_id,'state',j.state,'leaseUntil',j.lease_until,
  'availableAt',j.available_at,'processingStatus',i.processing_status,
  'scheduleActive',schedule_active,'schedulerAvailable',coalesce(schedule_active and budget_available and target_user=owner_id
   and cardinality(target_items) between 1 and 3 and j.item_id=any(target_items),false)) order by j.item_id),'[]'::jsonb) into result
 from private.gmail_analysis_jobs j join public.items i on i.id=j.item_id and i.user_id=j.user_id
 where j.user_id=owner_id and j.item_id=any(p_item_ids);
 return result;
end $$;
revoke all on function public.gmail_analysis_job_status(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.gmail_analysis_job_status(uuid[]) to authenticated;

-- Existing enqueue remains available to explicit operator tools. Browser admission
-- checks the actual scheduled demo as well as the app's server-only configuration.
create function public.request_gmail_analysis(p_item_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); target_user uuid; target_items uuid[];
 i public.items%rowtype; j private.gmail_analysis_jobs%rowtype;
begin
 if owner_id is null then raise exception 'Forbidden' using errcode='42501'; end if;
 -- Same outer lock as free claims and dispatch: a simultaneous auto-stop cannot
 -- use an empty-queue snapshot taken before this admission commits.
 perform singleton from private.gmail_free_budget where singleton for update;
 perform id from public.users where id=owner_id for no key update;
 select * into i from public.items where id=p_item_id and user_id=owner_id for update;
 if not found then raise exception 'Forbidden' using errcode='42501'; end if;
 if i.source<>'gmail' or i.format<>'email' or nullif(btrim(i.content_text),'') is null or length(i.content_text)>200000
 then raise exception 'Invalid analysis input' using errcode='22023'; end if;
 perform private.expire_gmail_analysis_lease(owner_id,p_item_id);
 select * into i from public.items where id=p_item_id and user_id=owner_id;
 select * into j from private.gmail_analysis_jobs where item_id=p_item_id and user_id=owner_id for update;
 if i.processing_status='analyzing' or j.state='running' then
  return jsonb_build_object('state','running','processingStatus',i.processing_status);
 end if;
 if j.state='complete' and j.revision=md5(i.content_text||coalesce(i.content_hash,'')) and i.processing_status in ('indexing','completed') then
  return jsonb_build_object('state','complete','processingStatus',i.processing_status);
 end if;
 begin
  select decrypted_secret::uuid into target_user from vault.decrypted_secrets where name='etc_gmail_analysis_user';
  select string_to_array(decrypted_secret,',')::uuid[] into target_items from vault.decrypted_secrets where name='etc_gmail_analysis_items';
 exception when invalid_text_representation then raise exception 'Worker configuration unavailable' using errcode='PT502'; end;
 if target_user is null or coalesce(cardinality(target_items),0) not between 1 and 3 then
  raise exception 'Worker configuration unavailable' using errcode='PT502';
 end if;
 if target_user<>owner_id or not (p_item_id=any(target_items)) then raise exception 'Outside worker scope' using errcode='PT403'; end if;
 if not exists(select 1 from cron.job where jobname='etc-gmail-demo' and active)
  or exists(select 1 from private.gmail_free_budget where budget_day=(clock_timestamp() at time zone 'UTC')::date and reserved>=5) then
  raise exception 'Worker schedule paused' using errcode='PT503';
 end if;
 perform public.enqueue_gmail_analysis(owner_id,array[p_item_id]);
 select * into j from private.gmail_analysis_jobs where item_id=p_item_id and user_id=owner_id;
 if not found then raise exception 'Invalid analysis input' using errcode='22023'; end if;
 if j.state='pending' then
  update public.items set processing_status='queued',processing_error=null where id=p_item_id and user_id=owner_id returning * into i;
 end if;
 return jsonb_build_object('state',j.state,'processingStatus',i.processing_status);
end $$;
revoke all on function public.request_gmail_analysis(uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_gmail_analysis(uuid) to authenticated;

create or replace function private.dispatch_gmail_analysis() returns bigint
language plpgsql security definer set search_path='' as $$
declare target_user uuid; target_items uuid[]; target_url text; secret text; stamp text; signature text;
begin
 perform singleton from private.gmail_free_budget where singleton for update;
 select decrypted_secret::uuid into target_user from vault.decrypted_secrets where name='etc_gmail_analysis_user';
 select string_to_array(decrypted_secret,',')::uuid[] into target_items from vault.decrypted_secrets where name='etc_gmail_analysis_items';
 if target_user is null or coalesce(cardinality(target_items),0) not between 1 and 3 then return null; end if;
 if not exists(select 1 from private.gmail_analysis_jobs where user_id=target_user and item_id=any(target_items) and state in ('pending','running','retry'))
   or exists(select 1 from private.gmail_free_budget where budget_day=(clock_timestamp() at time zone 'UTC')::date and reserved>=5) then
  if exists(select 1 from cron.job where jobname='etc-gmail-demo') then perform cron.unschedule('etc-gmail-demo'); end if;
  return null;
 end if;
 if not exists(select 1 from private.gmail_analysis_jobs where user_id=target_user and item_id=any(target_items)
   and ((state in ('pending','retry') and available_at<=clock_timestamp()) or (state='running' and lease_until<=clock_timestamp()))) then return null; end if;
 select decrypted_secret into target_url from vault.decrypted_secrets where name='etc_gmail_analysis_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='etc_gmail_analysis_secret';
 if target_url is distinct from 'https://ai-hub-one-ebon.vercel.app/api/internal/gmail-analysis' or coalesce(length(secret),0)<32 then raise exception 'Scheduler configuration missing'; end if;
 stamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 signature:=encode(extensions.hmac(E'POST\n/api/internal/gmail-analysis\n'||stamp,secret,'sha256'),'hex');
 return net.http_post(url:=target_url,body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','x-etc-timestamp',stamp,'x-etc-signature',signature),
  timeout_milliseconds:=120000);
end $$;

create or replace function public.claim_free_gmail_analysis_job(p_allowed_users uuid[],p_item_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.gmail_free_budget%rowtype; picked jsonb; item_id uuid;
 today date := (clock_timestamp() at time zone 'UTC')::date;
begin
 if cardinality(p_allowed_users) is distinct from 1 or p_allowed_users[1] is null
  or coalesce(cardinality(p_item_ids),0) not between 1 and 3 or array_position(p_item_ids,null) is not null
 then raise exception 'Explicit demo scope required'; end if;
 -- Keep the global budget lock first. Cleanup can run even at zero remaining quota.
 select * into strict b from private.gmail_free_budget where singleton for update;
 foreach item_id in array p_item_ids loop
  perform private.expire_gmail_analysis_lease(p_allowed_users[1],item_id);
 end loop;
 if b.next_at>clock_timestamp() then return null; end if;
 if b.budget_day<>today then b.reserved:=0; end if;
 if b.reserved>=5 then return null; end if;
 picked:=public.claim_gmail_analysis_job(p_allowed_users,p_item_ids);
 if picked is not null then
  update private.gmail_free_budget set budget_day=today,reserved=b.reserved+1,
   next_at=clock_timestamp()+interval '60 seconds' where singleton;
  perform private.schedule_gmail_analysis_lease_cleanup((picked->>'userId')::uuid,(picked->>'itemId')::uuid);
 end if;
 return picked;
end $$;

-- Recover only already-running approved demo work on rollout. No historical jobs
-- are enqueued and the processing schedule is neither created nor restarted.
do $$
declare target_user uuid; target_items uuid[]; running record;
begin
 begin
  select decrypted_secret::uuid into target_user from vault.decrypted_secrets where name='etc_gmail_analysis_user';
  select string_to_array(decrypted_secret,',')::uuid[] into target_items from vault.decrypted_secrets where name='etc_gmail_analysis_items';
 exception when invalid_text_representation then
  raise notice 'Gmail lease cleanup registration skipped: invalid demo scope'; return;
 end;
 if target_user is null or coalesce(cardinality(target_items),0) not between 1 and 3 then return; end if;
 for running in select item_id from private.gmail_analysis_jobs where user_id=target_user and item_id=any(target_items) and state='running' loop
  perform private.schedule_gmail_analysis_lease_cleanup(target_user,running.item_id);
 end loop;
end $$;

commit;
