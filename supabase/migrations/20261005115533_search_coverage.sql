-- Search-3: own-corpus coverage only. No indexing/provider calls.
begin;
create function public.search_coverage(p_user_id uuid,p_version text) returns jsonb
language sql stable security invoker set search_path='' as $$
select jsonb_build_object('scope','owner_corpus','totalItems',count(*),'semanticIndexedItems',count(*) filter(where exists(
 select 1 from private.search_index_jobs j where j.user_id=p_user_id and j.item_id=i.id and j.version=p_version and j.state='complete' and j.semantic
 and j.text_revision=md5(i.title||chr(10)||coalesce(i.content_text,'')||chr(10)||coalesce(i.metadata#>'{upload,extraction,pages}','null'::jsonb)::text||coalesce(i.metadata#>'{drive,tabs}','null'::jsonb)::text)
 and exists(select 1 from public.search_chunks c where c.user_id=p_user_id and c.item_id=i.id and c.embedding_version=p_version and c.index_fingerprint=j.fingerprint and c.embedding is not null))))
from public.items i where i.user_id=p_user_id;
$$;
revoke all on function public.search_coverage(uuid,text) from public,anon,authenticated;
grant execute on function public.search_coverage(uuid,text) to service_role;
commit;
