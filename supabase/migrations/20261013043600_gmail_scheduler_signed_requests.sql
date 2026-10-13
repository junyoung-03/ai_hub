-- Managed pg_net queue ownership prevents revoking its default PUBLIC grants.
-- Keep persistent credentials in Vault; the queue contains only a short-lived HMAC.
create function private.dispatch_gmail_analysis() returns bigint
language plpgsql security definer set search_path='' as $$
declare target_user uuid; target_items uuid[]; target_url text; secret text; stamp text; signature text;
begin
 select decrypted_secret::uuid into target_user from vault.decrypted_secrets where name='etc_gmail_analysis_user';
 select string_to_array(decrypted_secret,',')::uuid[] into target_items from vault.decrypted_secrets where name='etc_gmail_analysis_items';
 if target_user is null or coalesce(cardinality(target_items),0) not between 1 and 3 then return null; end if;
 -- This is a bounded demonstration schedule. Stop automatically when done or budget spent.
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
revoke all on function private.dispatch_gmail_analysis() from public,anon,authenticated,service_role;
