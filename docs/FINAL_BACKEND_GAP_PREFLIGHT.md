# FINAL BACKEND GAP FIX — Schema preflight / approval review

Date: 2026-10-06 (Asia/Seoul)
Preflight 당시 RESULT: **NEEDS_APPROVAL**

후속 기록: 사용자의 “승인할게” 승인 후 검토된 RPC 추가 migration을 dev에 적용했다.
아래는 승인 전 검토 내용을 보존한 기록이다. 현재 결과는
[FINAL_BACKEND_GAP_REPORT.md](FINAL_BACKEND_GAP_REPORT.md)의 **PARTIAL** 판정을 따른다.

Product code, UI, remote data, permissions, and migrations have not been changed in this task.
This document is a review draft, not a migration or an approved API contract.

## Required DB decision

Existing columns are sufficient for Classification editing and Action complete/restore.
AI persistence is different: the only remote analysis persistence RPC is
`persist_gmail_item_analysis`. Both the application and SQL require Gmail/email.
Drive/document and Upload/pdf,image cannot use that RPC without changing the DB function boundary.
Calling `upsert_ai_classification` and writing Action/Evidence separately would lose the existing
atomic transaction, owner lock, Evidence validation, duplicate matching and rollback guarantees.
Changing an ITEM source temporarily to Gmail would violate Unified ITEM and source tracking.

The user's request permits proceeding with existing schema/RPCs and requires stopping before
creating a migration when a new DB schema is needed. A new DB function is a schema object;
therefore this review stops before creating its migration. No new column/table/enum/status,
RLS policy, trigger, index, bucket, or destructive migration is proposed.

### 1. Minimum change

Add one server-only `persist_eligible_item_analysis` RPC using the existing atomic persistence body.
Keep the existing Gmail RPC unchanged for compatibility. Extend only the locked ITEM eligibility
predicate to Gmail/email, Drive/document and completed Upload/pdf,image extraction.
Calendar, manual input and unsupported formats remain excluded. The SQL below is the complete
review draft, derived from the existing local applied Gmail migration; it is not executed.
Approval would authorize creating and testing a reproducible non-destructive function migration,
then applying it to ai-hub-dev only after local validation. Production is excluded.

### 2. Existing data impact

Creating the function does not update existing rows. No old mail, Drive or Upload backfill is allowed.
The caller will use server-stored canonical text and explicitly verified owner, source, extraction
and current analysis fingerprint. Analysis transactions preserve user overrides and reused Action
completion; failed analysis does not undo collection/upload persistence.
Confirmed deadlines and Evidence rules remain unchanged. New analysis writes will be exercised
with synthetic/non-sensitive data first and bounded per user operation.

### 3. RLS / privilege impact

No RLS changes. Existing classifications/actions expose owner-only SELECT policies.
Classification writes can use the authenticated `set_classification_override` RPC; it derives
ownership from auth.uid and preserves AI fields. Action status writes need server-only admin
execution after authenticated owner validation, restricted to status/completed_at with CAS.
The new RPC retains SECURITY DEFINER, empty search_path, explicit owner/ITEM locks, grounded
Evidence checks and PUBLIC/anon/authenticated EXECUTE revocation; only service_role can execute.
No browser service key or model-provided owner ID is permitted.

### 4. Rollback

Before switching callers: revoke/drop the unused new function to roll back the DDL.
After switching callers: revert callers to Gmail-only first, then drop the new function.
Existing Gmail function stays available throughout. Do not delete analysis rows created after
approval to simulate rollback; committed business data needs a separate reviewed recovery plan.

### 5. Verification before apply

Check the remote/local original function body match; validate the proposed SQL in an isolated
transaction/database. Test owner/foreign/anonymous execution, unsupported/Calendar rejection,
stale content, atomic rollback, user override preservation, idempotency and Evidence dedupe.
No live Gemini request, synthetic row write or migration apply has occurred in this preflight.

## Requested 26-item report

1. Schema preflight: remote read-only inspection PASS. Existing user_* overrides/user_edited_at,
   Action status open/completed and completed_at confirmed.
2. Migration: no table/column/enum/RLS changes needed; one additional analysis RPC requires approval.
3. Classification API: existing route absent. Existing override RPC usable; partial PATCH must retain
   omitted overrides and keep original AI values. Implementation pending approval gate.
4. Classification E2E: not run in this task.
5. Override protection: upsert_ai_classification updates only AI columns; user columns preserved.
6. Action API: existing route absent; SPEC route is PATCH /api/v1/actions/{actionId}/status.
   Existing columns usable. Same-state requests must not reset completed_at; restore sets null.
7. Action E2E: not run in this task.
8. Search/Action: existing Action SQL filters status=open. Requery after writes must bypass stale
   action snapshot/cache; this remains a required implementation/test, not a completed claim.
9. Gmail AI: current owner query and atomic RPC are Gmail/email only. Preserve existing behavior.
10. Drive AI: canonical document text exists; source restriction blocks current atomic save.
11. Upload AI: only server-persisted complete extraction text is eligible; current RPC blocks source.
12. Calendar: excluded from proposed orchestration; event date remains separate from deadline.
13. Gemini failure: existing provider has finite retries for 429/503 and total 120s budget, no retry
    for malformed/validation failures. Future multi-ITEM orchestration must isolate each failure
    and preserve successful collection/upload; not verified as a new flow yet.
14. Security: remote RLS SELECT ownership and RPC EXECUTE boundaries inspected. New API security
    tests pending; no security or credential changes performed.
15. Data preservation: remote current counts are 57 ITEM (Gmail 51, Drive 1, Calendar 1, Upload 4),
    differing from pasted historical 50 ITEM baseline. No writes in this preflight; counts alone
    do not establish byte-for-byte preservation. No tokens or derived fingerprints inspected.
16. Browser E2E: not run for the new gaps. Previous UI-stage browser PASS is historical evidence.
17. UI regression: no frontend edit in this task; no redesign or navigation changes.
18. Tests: new tests 0; previous 136 PASS retained as prior evidence, not rerun results.
19. Quality: typecheck/lint/build/check:supabase not rerun because implementation is paused before
    DB changes; final diff check covers only this review document.
20. Documentation: this approval review only. SPEC/API_SPEC/PROJECT_STATE remain unchanged;
    proposed contracts will be updated together after implementation PASS.
21. P0: all 3 gaps remain unimplemented in this task.
22. P1: existing deployment/mobile and broader operational verification TODOs remain out of scope.
23. P2: existing Evidence highlighting/accessibility follow-up remains out of scope.
24. FINAL BACKEND GAP FIX COMPLETE: No.
25. MVP Backend Integration COMPLETE: No.
26. Next step: approve the single server-only RPC addition on ai-hub-dev, then implement the three
    gaps, bounded orchestration, minimum UI wiring and requested tests/E2E. No Production deploy.

## SQL review draft — NOT CREATED AS A MIGRATION / NOT EXECUTED

```sql
-- REVIEW DRAFT ONLY: not a migration; not executed. Preserve the existing Gmail RPC.
begin;
create function public.persist_eligible_item_analysis(
  p_user_id uuid, p_item_id uuid, p_content_text text, p_content_hash text,
  p_analysis jsonb, p_model text, p_input_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_candidate jsonb; v_quote jsonb; v_observation jsonb; v_locator jsonb;
  v_key text; v_action_id uuid; v_source_id uuid;
  v_existing public.action_sources%rowtype; v_selected public.action_sources%rowtype;
  v_date date; v_at timestamptz; v_distinct integer; v_matches integer;
  v_unclear boolean; v_had_sources boolean;
  v_created integer := 0; v_reused integer := 0; v_seen uuid[] := '{}'::uuid[];
begin
  if p_user_id is null or p_item_id is null or nullif(btrim(p_model),'') is null
     or p_input_fingerprint is null or p_input_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid analysis request' using errcode='22023';
  end if;
  -- Lock owner before children. NO KEY UPDATE is compatible with FK KEY SHARE locks.
  perform u.id from public.users u where u.id=p_user_id for no key update;
  if not found then raise exception 'ITEM not found' using errcode='P0002'; end if;
  select * into v_item from public.items where id=p_item_id and user_id=p_user_id
    and ((source='gmail' and format='email')
      or (source='drive' and format='document')
      or (source='upload' and format in ('pdf','image')
        and metadata#>>'{upload,extraction,status}'='complete'
        and metadata#>>'{upload,extraction,version}'='upload-text-v1')) for update;
  if not found then raise exception 'ITEM not found' using errcode='P0002'; end if;
  if v_item.content_text is distinct from p_content_text
    or v_item.content_hash is distinct from p_content_hash
    or nullif(btrim(p_content_text),'') is null then
    raise exception 'ITEM content changed' using errcode='22023';
  end if;
  if p_analysis is null or p_analysis->>'schemaVersion' is distinct from '0.2'
     or jsonb_typeof(p_analysis->'classification') is distinct from 'object'
     or jsonb_typeof(p_analysis->'actions') is distinct from 'array'
     or jsonb_typeof(p_analysis->'eventObservations') is distinct from 'array'
     or nullif(btrim(p_analysis#>>'{classification,primaryTopic}'),'') is null then
    raise exception 'Invalid analysis result' using errcode='22023';
  end if;
  if jsonb_array_length(p_analysis->'actions')>10
    or jsonb_array_length(p_analysis->'eventObservations')>10 then
    raise exception 'Too many candidates' using errcode='22023';
  end if;
  -- Exact repeat is a no-op, including updated_at and historical Evidence rows.
  if v_item.metadata#>>'{aiAnalysis,schemaVersion}'='0.2'
    and v_item.metadata#>>'{aiAnalysis,model}'=p_model
    and v_item.metadata#>>'{aiAnalysis,inputFingerprint}'=p_input_fingerprint
    and v_item.metadata#>'{aiAnalysis,result}'=p_analysis then
    return jsonb_build_object('created_count',0,'reused_count',jsonb_array_length(p_analysis->'actions'),
      'action_count',jsonb_array_length(p_analysis->'actions'),'cached',true);
  end if;
  -- Reject non-grounded/invalid offsets even for trusted server RPC requests.
  for v_candidate in select value from jsonb_array_elements(p_analysis->'actions') loop
    if nullif(btrim(v_candidate->>'title'),'') is null
      or jsonb_typeof(v_candidate->'evidence') is distinct from 'array' then
      raise exception 'Invalid action' using errcode='22023';
    end if;
    if jsonb_array_length(v_candidate->'evidence') not between 1 and 5 then
      raise exception 'Invalid action evidence' using errcode='22023';
    end if;
  end loop;
  for v_quote in
    select e.value from jsonb_array_elements(p_analysis->'actions') a,
      lateral jsonb_array_elements(a.value->'evidence') e
    union all
    select a.value#>'{startObservation,evidence}' from jsonb_array_elements(p_analysis->'actions') a
      where a.value#>>'{startObservation,status}' <> 'none'
    union all
    select a.value#>'{deadlineObservation,evidence}' from jsonb_array_elements(p_analysis->'actions') a
      where a.value#>>'{deadlineObservation,status}' <> 'none'
    union all
    select e.value->'evidence' from jsonb_array_elements(p_analysis->'eventObservations') e
  loop
    if nullif(btrim(v_quote->>'text'),'') is null
      or v_quote#>>'{locator,kind}' is distinct from 'text_span'
      or v_quote#>>'{locator,field}' is distinct from 'content_text'
      or v_quote#>>'{locator,startChar}' is null or v_quote#>>'{locator,endChar}' is null
      or (v_quote#>>'{locator,startChar}')::integer<0
      or (v_quote#>>'{locator,endChar}')::integer<=(v_quote#>>'{locator,startChar}')::integer
      or substring(p_content_text from (v_quote#>>'{locator,startChar}')::integer+1
        for (v_quote#>>'{locator,endChar}')::integer-(v_quote#>>'{locator,startChar}')::integer)
        is distinct from v_quote->>'text' then
      raise exception 'Evidence or locator is absent from ITEM' using errcode='22023';
    end if;
  end loop;
  for v_observation in
    select a.value->'startObservation' from jsonb_array_elements(p_analysis->'actions') a
    union all select a.value->'deadlineObservation' from jsonb_array_elements(p_analysis->'actions') a
    union all select value from jsonb_array_elements(p_analysis->'eventObservations')
  loop
    if v_observation->>'status' is null or v_observation->>'status' not in ('confirmed','needs_review','none')
      or (v_observation->>'status'='confirmed' and v_observation->>'date' is null)
      or (v_observation->>'status'<>'confirmed' and (v_observation->>'date' is not null or v_observation->>'datetime' is not null))
      or (v_observation->>'status'<>'none' and (nullif(btrim(v_observation->>'rawText'),'') is null
        or position((v_observation->>'rawText') in (v_observation#>>'{evidence,text}'))=0)) then
      raise exception 'Invalid date observation' using errcode='22023';
    end if;
  end loop;

  perform public.upsert_ai_classification(p_user_id,p_item_id,p_analysis#>>'{classification,primaryTopic}',
    (p_analysis#>>'{classification,documentType}')::public.document_type,
    array(select jsonb_array_elements_text(p_analysis#>'{classification,tags}')));
  -- Owner-wide transaction lock serializes managed Action matching across requests.
  -- It does not replace existing actual-update Evidence parent locks.
  perform a.id from public.actions a where a.user_id=p_user_id and exists (
    select 1 from public.action_sources s where s.action_id=a.id and s.user_id=p_user_id
      and s.item_id=p_item_id and s.is_current) order by a.id for update;
  select exists(select 1 from public.action_sources s where s.user_id=p_user_id
    and s.item_id=p_item_id and s.is_current) into v_had_sources;

  for v_candidate in select value from jsonb_array_elements(p_analysis->'actions') loop
    v_key:=lower(regexp_replace(btrim(v_candidate->>'title'),'\s+',' ','g')) || ':' || (v_candidate->>'actionType');
    select count(*) into v_matches from public.action_sources s join public.actions a
      on a.id=s.action_id and a.user_id=s.user_id
      where s.user_id=p_user_id and s.item_id=p_item_id and s.is_current
        and (s.evidence_locator->>'analysisKey'=v_key or (s.evidence_text=v_candidate#>>'{evidence,0,text}'
          and a.action_type::text=v_candidate->>'actionType'));
    if v_matches>1 then raise exception 'Ambiguous action match' using errcode='22023'; end if;
    select s.* into v_existing from public.action_sources s join public.actions a
      on a.id=s.action_id and a.user_id=s.user_id
      where s.user_id=p_user_id and s.item_id=p_item_id and s.is_current
        and (s.evidence_locator->>'analysisKey'=v_key or (s.evidence_text=v_candidate#>>'{evidence,0,text}'
          and a.action_type::text=v_candidate->>'actionType')) order by s.id limit 1;
    if found then
      v_action_id:=v_existing.action_id;
      if v_action_id=any(v_seen) then raise exception 'Ambiguous action match' using errcode='22023'; end if;
      v_reused:=v_reused+1;
    else
      if v_had_sources then raise exception 'Action matching requires review' using errcode='22023'; end if;
      insert into public.actions(user_id,title,action_type,start_date,start_at,requirements,conditions)
        values(p_user_id,v_candidate->>'title',(v_candidate->>'actionType')::public.action_type,
          (v_candidate#>>'{startObservation,date}')::date,(v_candidate#>>'{startObservation,datetime}')::timestamptz,
          array(select jsonb_array_elements_text(v_candidate->'requirements')),
          array(select jsonb_array_elements_text(v_candidate->'conditions'))) returning id into v_action_id;
      v_created:=v_created+1;
    end if;
    v_seen:=array_append(v_seen,v_action_id);
    if exists(select 1 from public.actions where id=v_action_id and user_id=p_user_id
      and deadline_resolution_reason is not null) then
      raise exception 'Resolved deadline requires review' using errcode='22023';
    end if;
    v_date:=(v_candidate#>>'{deadlineObservation,date}')::date;
    v_at:=(v_candidate#>>'{deadlineObservation,datetime}')::timestamptz;
    -- First quote remains directly accessible to current Detail UI; all quotes are preserved.
    v_locator:=(v_candidate#>'{evidence,0,locator}') || jsonb_build_object('analysisKey',v_key,
      'schemaVersion','0.2','evidence',v_candidate->'evidence','startObservation',v_candidate->'startObservation',
      'deadlineObservation',v_candidate->'deadlineObservation');
    if v_existing.action_id=v_action_id and v_existing.evidence_locator=v_locator
      and v_existing.evidence_text=v_candidate#>>'{evidence,0,text}'
      and v_existing.observed_deadline_date is not distinct from v_date
      and v_existing.observed_deadline_at is not distinct from v_at then
      v_source_id:=v_existing.id;
    else
      update public.action_sources set is_current=false where action_id=v_action_id
        and item_id=p_item_id and user_id=p_user_id and is_current;
      insert into public.action_sources(user_id,action_id,item_id,evidence_text,evidence_locator,
        observed_deadline_date,observed_deadline_at)
        values(p_user_id,v_action_id,p_item_id,v_candidate#>>'{evidence,0,text}',v_locator,v_date,v_at)
        returning id into v_source_id;
    end if;
    select count(*) into v_distinct from (select distinct observed_deadline_date,observed_deadline_at
      from public.action_sources where action_id=v_action_id and user_id=p_user_id
        and is_current and observed_deadline_date is not null) d;
    select coalesce(bool_or(evidence_locator#>>'{deadlineObservation,status}'='needs_review'),false) into v_unclear
      from public.action_sources where action_id=v_action_id and user_id=p_user_id and is_current;
    select * into v_selected from public.action_sources where action_id=v_action_id and user_id=p_user_id
      and is_current and observed_deadline_date is not null order by id limit 1;
    update public.actions set
      deadline_status=(case when v_distinct>1 or v_unclear then 'needs_review' when v_distinct=1 then 'confirmed' else 'none' end)::public.deadline_status,
      deadline_date=case when v_distinct=1 and not v_unclear then v_selected.observed_deadline_date end,
      deadline_at=case when v_distinct=1 and not v_unclear then v_selected.observed_deadline_at end,
      deadline_source_id=case when v_distinct=1 and not v_unclear then v_selected.id end,
      deadline_resolution_reason=null,deadline_resolved_at=null
      where id=v_action_id and user_id=p_user_id;
    -- Reused Action title/start/requirements/completion fields are intentionally preserved.
    v_existing:=null;
  end loop;
  if exists(select 1 from public.action_sources where user_id=p_user_id and item_id=p_item_id and is_current
    and evidence_locator ? 'analysisKey' and not (action_id=any(v_seen))) then
    raise exception 'Removed action requires review' using errcode='22023';
  end if;
  update public.items set processing_status='indexing',processing_error=null,
    metadata=metadata || jsonb_build_object('aiAnalysis',jsonb_build_object('schemaVersion','0.2',
      'model',p_model,'inputFingerprint',p_input_fingerprint,'analyzedAt',now(),'result',p_analysis))
    where id=p_item_id and user_id=p_user_id;
  return jsonb_build_object('created_count',v_created,'reused_count',v_reused,
    'action_count',jsonb_array_length(p_analysis->'actions'),'cached',false);
end;
$$;
revoke all on function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text) to service_role;
comment on function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text) is
  'Phase 6A v0.2 atomic AI-only persistence. Server schema/semantic validation is mandatory before calling.';
commit;

```

Rollback DDL (only after reverting any callers):

```sql
begin;
revoke all on function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text) from service_role;
drop function public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text);
commit;
```
