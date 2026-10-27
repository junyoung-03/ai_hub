-- Retry admission keeps the existing ITEM/job locks until cooldown check and reset finish.
-- An explicit user retry never bypasses a newer failure's provider wait period.
begin;
create function public.retry_search_index(p_user_id uuid,p_item_id uuid,p_version text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_job jsonb;
begin
 current_job:=public.search_index('read',p_user_id,p_item_id,p_version);
 if nullif(current_job->>'retryAfter','')::timestamptz>clock_timestamp() then
  return current_job||jsonb_build_object('state','failed');
 end if;
 perform public.search_index('reset_retry',p_user_id,p_item_id,p_version);
 return jsonb_build_object('state','pending');
end $$;
revoke all on function public.retry_search_index(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.retry_search_index(uuid,uuid,text) to service_role;
commit;
