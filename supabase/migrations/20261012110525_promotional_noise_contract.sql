-- Approved promotional contract. Rehearse in an isolated DB; do not apply to production.
begin;

create table public.item_noise_assessments (
  item_id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  ai_verdict text check (ai_verdict in ('normal','promotional','uncertain')),
  ai_confidence double precision check (ai_confidence between 0 and 1),
  ai_reason jsonb not null default '[]' check (jsonb_typeof(ai_reason)='array'),
  ai_evidence jsonb not null default '[]' check (jsonb_typeof(ai_evidence)='array'),
  protection_reasons jsonb not null default '[]' check (jsonb_typeof(protection_reasons)='array'),
  input_fingerprint text, model_name text, assessment_version text, analyzed_at timestamptz,
  user_override text check (user_override in ('force_show','force_promotional')),
  user_override_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint item_noise_item_user_fk foreign key(item_id,user_id) references public.items(id,user_id) on delete cascade,
  check (ai_verdict is null or (input_fingerprint is not null and assessment_version is not null and input_fingerprint ~ '^[a-f0-9]{64}$' and model_name is not null
    and assessment_version='0.3' and analyzed_at is not null)),
  check (ai_verdict is distinct from 'promotional' or jsonb_array_length(ai_evidence)>0)
);
create index item_noise_user_verdict_idx on public.item_noise_assessments(user_id,ai_verdict);
alter table public.item_noise_assessments enable row level security;
create policy item_noise_select_own on public.item_noise_assessments for select to authenticated
  using (user_id=(select auth.uid()));
revoke all on public.item_noise_assessments from public,anon,authenticated,service_role;
grant select on public.item_noise_assessments to authenticated,service_role;

-- PostgreSQL/JS-compatible canonical fingerprint. No pgcrypto extension required.
create function public.noise_input_fingerprint(text,text) returns text
language sql immutable set search_path='' as $$
 select encode(sha256(convert_to('{"schemaVersion":"0.3","model":'||to_json($2)::text||
   ',"contentText":'||to_json($1)::text||'}','UTF8')),'hex');
$$;

create function private.noise_evidence_valid(p_content text,p_evidence jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare q jsonb; s integer; e integer;
begin
 if jsonb_typeof(p_evidence) is distinct from 'array' then return false; end if;
 for q in select value from jsonb_array_elements(p_evidence) loop
  s:=(q#>>'{locator,startChar}')::integer; e:=(q#>>'{locator,endChar}')::integer;
  if s is null or e is null or s<0 or e<=s or nullif(btrim(q->>'text'),'') is null
    or q#>>'{locator,kind}' is distinct from 'text_span'
    or q#>>'{locator,field}' is distinct from 'content_text'
    or substring(p_content from s+1 for e-s) is distinct from q->>'text' then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

-- Pure read projection, never changes ai_verdict to satisfy visibility.
-- Unnamed row parameter supports PostgREST computed fields without a public RPC body.
create function public.item_noise_state(public.items) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare i public.items:=$1; n public.item_noise_assessments%rowtype;
 reasons text[]:='{}'; s jsonb; valid boolean:=false; visible boolean:=true;
begin
 select * into n from public.item_noise_assessments where item_id=i.id and user_id=i.user_id;
 if n.ai_verdict is null then reasons:=array_append(reasons,'assessment_unavailable');
 elsif n.assessment_version is distinct from '0.3' or n.input_fingerprint is distinct from public.noise_input_fingerprint(i.content_text,n.model_name)
   or i.metadata#>>'{aiAnalysis,inputFingerprint}' is distinct from n.input_fingerprint
   or i.metadata#>>'{aiAnalysis,schemaVersion}' is distinct from '0.3' then
  reasons:=array_append(reasons,'assessment_stale');
 elsif i.processing_status::text not in ('indexing','completed') then reasons:=array_append(reasons,'analysis_incomplete');
 else valid:=true;
 end if;
 -- Evidence is verified at write time; reads compare fingerprints, not the entire document.
 if valid and n.ai_verdict='promotional' and jsonb_array_length(n.ai_evidence)=0 then
  valid:=false; reasons:=array_append(reasons,'invalid_evidence');
 end if;
 if exists(select 1 from public.action_sources s join public.actions a on a.id=s.action_id and a.user_id=s.user_id
   where s.user_id=i.user_id and s.item_id=i.id) then reasons:=array_append(reasons,'action_exists'); end if;
 if exists(select 1 from public.action_sources s where s.user_id=i.user_id and s.item_id=i.id
   and (s.observed_deadline_date is not null or s.observed_deadline_at is not null
     or s.evidence_locator#>>'{deadlineObservation,status}' in ('confirmed','needs_review'))) then
  reasons:=array_append(reasons,'deadline_exists'); end if;
 if i.source::text='calendar' or (case when jsonb_typeof(i.metadata#>'{aiAnalysis,result,eventObservations}')='array'
   then jsonb_array_length(i.metadata#>'{aiAnalysis,result,eventObservations}')>0 else false end) then
  reasons:=array_append(reasons,'event_exists'); end if;
 if valid then
  for s in select value from jsonb_array_elements(n.protection_reasons) loop
   if s->>'reason' in ('payment','billing','contract','security','account','service_outage','personal_obligation','uncertain_relationship') then
    reasons:=array_append(reasons,s->>'reason');
   end if;
  end loop;
 end if;
 visible:=public.item_is_visible(i);
 return jsonb_build_object('aiVerdict',n.ai_verdict,'userOverride',n.user_override,'confidence',n.ai_confidence,
   'evidence',coalesce(n.ai_evidence,'[]'),'reasons',coalesce(n.ai_reason,'[]'),
   'protectionState',to_jsonb(reasons),'effectiveVisibility',case when visible then 'SHOW' else 'HIDE' end,
   'assessmentVersion',n.assessment_version);
exception when others then
 -- Read failures cannot create automatic hides. A valid explicit override still wins.
 return jsonb_build_object('aiVerdict',n.ai_verdict,'userOverride',n.user_override,
   'protectionState',jsonb_build_array('protection_check_unavailable'),
   'effectiveVisibility',case when n.user_override='force_promotional' then 'HIDE' else 'SHOW' end);
end $$;

create function public.item_is_visible(public.items) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare i public.items:=$1; n public.item_noise_assessments%rowtype;
begin
 select * into n from public.item_noise_assessments where item_id=i.id and user_id=i.user_id;
 if n.user_override='force_show' then return true; end if;
 if n.user_override='force_promotional' then return false; end if;
 if n.ai_verdict is distinct from 'promotional' then return true; end if;
 if n.assessment_version is distinct from '0.3' or i.processing_status::text not in ('indexing','completed')
  or n.input_fingerprint is distinct from public.noise_input_fingerprint(i.content_text,n.model_name)
  or i.metadata#>>'{aiAnalysis,inputFingerprint}' is distinct from n.input_fingerprint
  or i.metadata#>>'{aiAnalysis,schemaVersion}' is distinct from '0.3'
  or jsonb_array_length(n.ai_evidence)=0 then return true; end if;
 if i.source::text='calendar' then return true; end if;
 if jsonb_typeof(i.metadata#>'{aiAnalysis,result,eventObservations}')='array' then
  if jsonb_array_length(i.metadata#>'{aiAnalysis,result,eventObservations}')>0 then return true; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(n.protection_reasons) s where s->>'reason' in
  ('payment','billing','contract','security','account','service_outage','personal_obligation','uncertain_relationship')) then return true; end if;
 -- Every Deadline Source has an Action FK. Includes historical/completed sources.
 if exists(select 1 from public.action_sources where user_id=i.user_id and item_id=i.id) then return true; end if;
 return false;
exception when others then return n.user_override is distinct from 'force_promotional';
end;
$$;

create function public.get_item_noise_state(p_item_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare i public.items;
begin
 select * into i from public.items where id=p_item_id and user_id=auth.uid();
 if not found then raise exception 'ITEM not found' using errcode='P0002'; end if;
 return public.item_noise_state(i);
end $$;

create function public.set_noise_override(p_item_id uuid,p_override text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); i public.items;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_override is not null and p_override not in ('force_show','force_promotional') then
  raise exception 'Invalid noise override' using errcode='22023'; end if;
 select * into i from public.items where id=p_item_id and user_id=u for update;
 if not found then raise exception 'ITEM not found' using errcode='P0002'; end if;
 insert into public.item_noise_assessments(item_id,user_id,user_override,user_override_at)
 values(p_item_id,u,p_override,now()) on conflict(item_id) do update
 set user_override=excluded.user_override,user_override_at=excluded.user_override_at,updated_at=now();
 return public.item_noise_state(i);
end $$;

-- Clone exact existing v0.2 routines privately; retain Action matching, evidence, source guards and user classification protection.
do $clone$
declare name text; def text;
begin
 foreach name in array array['persist_gmail_item_analysis','persist_eligible_item_analysis'] loop
  def:=pg_get_functiondef(('public.'||name||'(uuid,uuid,text,text,jsonb,text,text)')::regprocedure);
  if position('0.2' in def)=0 then raise exception 'Unexpected analysis contract'; end if;
  execute replace(def,'FUNCTION public.'||name||'(', 'FUNCTION private.'||name||'_v02(');
  execute 'revoke all on function private.'||name||'_v02(uuid,uuid,text,text,jsonb,text,text) from public,anon,authenticated,service_role';
 end loop;
end $clone$;

create function private.persist_noise_analysis(p_user_id uuid,p_item_id uuid,p_content_text text,p_content_hash text,
 p_analysis jsonb,p_model text,p_input_fingerprint text,p_eligible boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.items; noise jsonb; signals jsonb; result jsonb; legacy jsonb;
begin
 -- This private helper is callable only by owner-controlled public wrappers.
 if p_analysis->>'schemaVersion'='0.2' then
  if p_eligible then return private.persist_eligible_item_analysis_v02(p_user_id,p_item_id,p_content_text,p_content_hash,p_analysis,p_model,p_input_fingerprint);
  else return private.persist_gmail_item_analysis_v02(p_user_id,p_item_id,p_content_text,p_content_hash,p_analysis,p_model,p_input_fingerprint); end if;
 end if;
 perform id from public.users where id=p_user_id for no key update;
 select * into i from public.items where id=p_item_id and user_id=p_user_id for update;
 if not found then raise exception 'ITEM not found' using errcode='P0002'; end if;
 if i.content_text is distinct from p_content_text or i.content_hash is distinct from p_content_hash
   or p_input_fingerprint is distinct from public.noise_input_fingerprint(i.content_text,p_model) then
  raise exception 'Stale analysis input' using errcode='PT409'; end if;
 noise:=p_analysis->'noiseAssessment';
 if p_analysis->>'schemaVersion' is distinct from '0.3' or jsonb_typeof(noise) is distinct from 'object'
  or noise->>'verdict' is null or noise->>'verdict' not in ('normal','promotional','uncertain')
  or jsonb_typeof(noise->'reasons') is distinct from 'array'
  or jsonb_typeof(noise->'protectionSignals') is distinct from 'array'
  or not private.noise_evidence_valid(p_content_text,noise->'evidence') then
  raise exception 'Invalid noise assessment' using errcode='22023'; end if;
 if noise->>'verdict'='promotional' and jsonb_array_length(noise->'evidence')=0 then
  raise exception 'Promotional evidence required' using errcode='22023'; end if;
 if noise->>'verdict'='promotional' and ((noise->'reasons' ?| array['non_promotional','insufficient_context'])
  or not (noise->'reasons' ?| array['discount','coupon','sales','marketing_newsletter','general_promotion'])) then
  raise exception 'Conflicting promotional reason' using errcode='22023'; end if;
 if noise->>'verdict'='uncertain' and not (noise->'reasons' ? 'insufficient_context') then
  raise exception 'Uncertain reason required' using errcode='22023'; end if;
 select coalesce(jsonb_agg(value->'evidence'),'[]') into signals from jsonb_array_elements(noise->'protectionSignals');
 if not private.noise_evidence_valid(p_content_text,signals) or exists(select 1 from jsonb_array_elements(noise->'protectionSignals') s
  where s->>'reason' is null or s->>'reason' not in ('payment','billing','contract','security','account','service_outage','personal_obligation','uncertain_relationship')) then
  raise exception 'Invalid protection evidence' using errcode='22023'; end if;
 legacy:=(p_analysis-'noiseAssessment')||jsonb_build_object('schemaVersion','0.2');
 if p_eligible then result:=private.persist_eligible_item_analysis_v02(p_user_id,p_item_id,p_content_text,p_content_hash,legacy,p_model,p_input_fingerprint);
 else result:=private.persist_gmail_item_analysis_v02(p_user_id,p_item_id,p_content_text,p_content_hash,legacy,p_model,p_input_fingerprint); end if;
 update public.items set metadata=jsonb_set(metadata,'{aiAnalysis}',
  (metadata->'aiAnalysis')||jsonb_build_object('schemaVersion','0.3','result',p_analysis)) where id=p_item_id and user_id=p_user_id;
 insert into public.item_noise_assessments(item_id,user_id,ai_verdict,ai_confidence,ai_reason,ai_evidence,
  protection_reasons,input_fingerprint,model_name,assessment_version,analyzed_at)
 values(p_item_id,p_user_id,noise->>'verdict',(noise->>'confidence')::double precision,noise->'reasons',noise->'evidence',
  noise->'protectionSignals',p_input_fingerprint,p_model,'0.3',now())
 on conflict(item_id) do update set ai_verdict=excluded.ai_verdict,ai_confidence=excluded.ai_confidence,
  ai_reason=excluded.ai_reason,ai_evidence=excluded.ai_evidence,protection_reasons=excluded.protection_reasons,
  input_fingerprint=excluded.input_fingerprint,model_name=excluded.model_name,assessment_version=excluded.assessment_version,
  analyzed_at=excluded.analyzed_at,updated_at=now();
 -- user_override and user_override_at are intentionally never updated by AI.
 return result;
end $$;

create or replace function public.persist_gmail_item_analysis(p_user_id uuid,p_item_id uuid,p_content_text text,p_content_hash text,
 p_analysis jsonb,p_model text,p_input_fingerprint text) returns jsonb
language sql security definer set search_path='' as $$
 select private.persist_noise_analysis($1,$2,$3,$4,$5,$6,$7,false);
$$;
create or replace function public.persist_eligible_item_analysis(p_user_id uuid,p_item_id uuid,p_content_text text,p_content_hash text,
 p_analysis jsonb,p_model text,p_input_fingerprint text) returns jsonb
language sql security definer set search_path='' as $$
 select private.persist_noise_analysis($1,$2,$3,$4,$5,$6,$7,true);
$$;

-- Guarded changes only at document eligibility, before keyword/vector candidate limits.
do $search$
declare def text; old text;
begin
 def:=pg_get_functiondef('public.search_candidates(uuid,text,text,extensions.vector,jsonb,jsonb)'::regprocedure);
 old:=$needle$from public.items i where i.user_id=p_user_id$needle$;
 if position(old in def)=0 then raise exception 'Unexpected search candidate contract'; end if;
 def:=replace(def,'FUNCTION public.search_candidates(', 'FUNCTION public.search_candidates_promotional(');
 execute replace(def,old,old||$predicate$
 and (p_intent->>'kind'='actions' or coalesce((p_filters->>'includePromotional')::boolean,false) or public.item_is_visible(i))$predicate$);
 revoke all on function public.search_candidates_promotional(uuid,text,text,extensions.vector,jsonb,jsonb) from public,anon,authenticated,service_role;
 grant execute on function public.search_candidates_promotional(uuid,text,text,extensions.vector,jsonb,jsonb) to service_role;
 def:=pg_get_functiondef('public.search_similar(uuid,uuid,text,integer)'::regprocedure);
 old:=$needle$where j.state='complete' and j.fingerprint=c.index_fingerprint$needle$;
 if position(old in def)=0 then raise exception 'Unexpected similar candidate contract'; end if;
 def:=replace(def,'FUNCTION public.search_similar(', 'FUNCTION public.search_similar_promotional(');
 execute replace(def,old,$predicate$where public.item_is_visible(i) and j.state='complete' and j.fingerprint=c.index_fingerprint$predicate$);
 revoke all on function public.search_similar_promotional(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
 grant execute on function public.search_similar_promotional(uuid,uuid,text,integer) to service_role;
 -- Also recheck a newly-created snapshot on page reads. This closes the race where
 -- candidate selection preceded a visibility write but snapshot creation followed it.
 def:=pg_get_functiondef('public.search_runtime(text,uuid,jsonb)'::regprocedure);
 old:=$needle$-- A fixed result window, re-authorized on every page.$needle$;
 if position(old in def)=0 then raise exception 'Unexpected search runtime contract'; end if;
 execute replace(def,old,$predicate$if coalesce((v_session.info->>'promotionalEnabled')::boolean,false)
   and coalesce(v_session.info->>'intent','documents')<>'actions'
   and not coalesce((v_session.info#>>'{appliedFilters,includePromotional}')::boolean,false)
   and exists(select 1 from jsonb_array_elements(v_session.results) x(result)
     join public.items i on i.id=(x.result->>'itemId')::uuid and i.user_id=p_user_id
     where x.result->>'kind'='item' and not public.item_is_visible(i)) then
    raise exception 'SEARCH_VISIBILITY_CHANGED' using errcode='P0002';
   end if;
   -- A fixed result window, re-authorized on every page.$predicate$);
end $search$;

-- Assessment/protection changes invalidate owner snapshots, never query embeddings/index generations.
create function private.invalidate_noise_snapshots() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then delete from private.search_sessions where user_id=old.user_id and info->>'promotionalEnabled'='true'; end if;
 if tg_op<>'DELETE' then delete from private.search_sessions where user_id=new.user_id and info->>'promotionalEnabled'='true'; end if;
 return null;
end $$;
create trigger noise_snapshot_changed after insert or update or delete on public.item_noise_assessments
 for each row execute function private.invalidate_noise_snapshots();
create trigger noise_source_changed after insert or update or delete on public.action_sources
 for each row execute function private.invalidate_noise_snapshots();
create trigger noise_action_changed after insert or update or delete on public.actions
 for each row execute function private.invalidate_noise_snapshots();
create trigger noise_item_changed after update of content_text,title,metadata,processing_status or delete on public.items
 for each row execute function private.invalidate_noise_snapshots();

revoke all on function public.noise_input_fingerprint(text,text),private.noise_evidence_valid(text,jsonb),
 private.persist_noise_analysis(uuid,uuid,text,text,jsonb,text,text,boolean),private.invalidate_noise_snapshots()
 from public,anon,authenticated,service_role;
-- Read-only helper used by the invoker policy; does not access any table.
grant execute on function public.noise_input_fingerprint(text,text) to authenticated,service_role;
revoke all on function public.item_noise_state(public.items),public.item_is_visible(public.items),
 public.get_item_noise_state(uuid),public.set_noise_override(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.item_noise_state(public.items),public.item_is_visible(public.items) to authenticated,service_role;
grant execute on function public.get_item_noise_state(uuid),public.set_noise_override(uuid,text) to authenticated;
revoke all on function public.persist_gmail_item_analysis(uuid,uuid,text,text,jsonb,text,text),
 public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.persist_gmail_item_analysis(uuid,uuid,text,text,jsonb,text,text),
 public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text) to service_role;
-- Read-only capability probe; missing or old schema caches disable the feature.
create function public.promotional_noise_ready() returns boolean
language sql stable security invoker set search_path='' as $$
 select to_regclass('public.item_noise_assessments') is not null
  and (select count(*) from pg_attribute where attrelid=to_regclass('public.item_noise_assessments') and not attisdropped
    and attname in ('item_id','user_id','ai_verdict','ai_confidence','ai_reason','ai_evidence','protection_reasons','input_fingerprint',
      'model_name','assessment_version','analyzed_at','user_override','user_override_at','created_at','updated_at'))=15
  and to_regprocedure('public.item_is_visible(public.items)') is not null
  and to_regprocedure('public.get_item_noise_state(uuid)') is not null
  and to_regprocedure('public.set_noise_override(uuid,text)') is not null
  and exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='search_candidates_promotional' and p.pronargs=6)
  and to_regprocedure('public.search_similar_promotional(uuid,uuid,text,integer)') is not null
  and exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='persist_noise_analysis' and p.pronargs=8)
  and position('private.persist_noise_analysis' in pg_get_functiondef('public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)'::regprocedure))>0
  and position('private.persist_noise_analysis' in pg_get_functiondef('public.persist_gmail_item_analysis(uuid,uuid,text,text,jsonb,text,text)'::regprocedure))>0;
$$;
revoke all on function public.promotional_noise_ready() from public,anon,authenticated,service_role;
grant execute on function public.promotional_noise_ready() to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
