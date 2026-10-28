-- Only the scheduler holding the active owner-bound lease can use background credentials.
begin;
create function public.gmail_sync_lease_valid(p_owner uuid,p_token uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and owner_id=p_owner and sync_token=p_token and sync_lease_until>clock_timestamp()
  from private.gmail_automation_config where singleton),false)
$$;
revoke all on function public.gmail_sync_lease_valid(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.gmail_sync_lease_valid(uuid,uuid) to service_role;
commit;
