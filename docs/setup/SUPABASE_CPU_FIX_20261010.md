# Supabase CPU hotfix — 2026-10-10

RESULT: REVIEW_REQUIRED (1차 dev 검증 시점의 기록)

## Root cause and scope

최근 24시간 postgres 로그에서 STALE_ATTEMPT 8,638,618건을 확인했다. 시간대별 약 359,970건/시간으로 반복됐다.
Upload RPC의 application-level stale/lease/CAS conflict를 실제 serialization failure SQLSTATE 40001로 발생시켜 PostgREST transaction retry를 유발했다.
공식 근거: [PostgREST custom HTTP errors](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes), [PostgREST transaction retry fix](https://github.com/PostgREST/postgrest/pull/3673).

이번 변경은 Upload의 8개 raise만 PT409로 교체했다. STALE_ATTEMPT 메시지는 유지한다.
서버의 sessionRpc는 PT409 + 정확한 STALE_ATTEMPT 메시지를 기존 UploadError/HTTP409로 매핑한다. 전환 중 이전 40001도 인식한다.
40001 실제 serialization failure/40P01의 제한된 전체 transaction retry는 변경하지 않았다.

## READ-ONLY 40001 audit

repo의 40001/STALE_ATTEMPT/serialization_failure 전체 검색과 원격 pg_proc 검사를 수행했다.
아래 7개 함수의 명시적 40001 raise는 모두 B(application CAS/stale conflict)이며 PostgreSQL 엔진이 실제로 발생시키는 A(serialization failure)가 아니다. 모든 함수는 서버 service_role의 PostgREST RPC 호출 경로에 있다.

| Function | Error message / count | SQLSTATE / usage | PostgREST | Change required |
| --- | --- | --- | --- | --- |
| upload_session_rpc | STALE_ATTEMPT / 8 | 40001 → PT409; attempt/lease/state/ITEM snapshot | YES, uploads/service.ts 및 cleanup.ts | 적용 완료 |
| search_runtime | SEARCH_CACHE_STALE / 1 | 40001; query cache CAS | YES, search/service.ts | YES, 후속 변경 필요 |
| search_index | SEARCH_STALE_INPUT, SEARCH_INDEX_STALE / 2 | 40001; ITEM snapshot/job attempt/lease/revision | YES, search/service.ts | YES, 후속 변경 필요 |
| persist_drive_item | Stale source snapshot; Same source version has conflicting content; ITEM changed during collection; Expected ITEM missing / 4 | 40001; source version/ITEM CAS | YES, google/drive-collection.ts | YES, SOURCE_CHANGED 매핑과 함께 변경 필요 |
| persist_calendar_item | ITEM changed during collection; Stale or unordered source snapshot; Expected ITEM missing / 3 | 40001; source version/ITEM CAS | YES, google/calendar-collection.ts | YES, SOURCE_CHANGED 매핑과 함께 변경 필요 |
| upgrade_google_connection_scopes | Connection changed during consent; Credentials changed during consent / 2 | 40001; OAuth connection/token CAS | YES, google/connections.ts | YES, 후속 변경 필요 |
| upgrade_google_calendar_scopes | Connection changed during consent; Credentials changed during consent / 2 | 40001; OAuth connection/token CAS | YES, google/connections.ts | YES, 후속 변경 필요 |

현재 함수 정의에 application 40001 raise 14개가 나머지 6개 함수에 남아 있다. 이번 장애에서 관찰한 STALE_ATTEMPT와 분리하여 보고하며 이 Migration에는 포함하지 않았다.
역사 Migration/보관 SQL fixture의 40001은 적용 이력 보존을 위해 수정하지 않았다. test-upload-sql은 최신 hotfix까지 적용한 결과를 검증한다.
supabase/baseline/0001_initial_schema.sql의 Evidence 부모 Action UPDATE에 의한 REPEATABLE READ serialization failure 설명, docs/api/API_SPEC.md의 transaction 오류 규칙, items/analysis.ts의 최대 3회 transaction 재시도 및 test-analysis.mjs는 실제 엔진 failure를 다루므로 유지했다.

## Migration and dev application

- File: supabase/migrations/20261010011615_upload_stale_attempt_nonretryable.sql
- Target: ai-hub-dev / oclzdppdiljbojvqtkeu only.
- Applied and verified: 2026-10-10 10:21:55 KST; exact version/name/statements history checked.
- Original function body MD5: 73f86bc776f9e1aab0f888b1d4740339.
- Fixed function body MD5: a2cc2ce8f1742254daa8c104dd4cbe53.
- Drift guard accepts only original/fixed bodies; repeat application tested in ephemeral PostgreSQL.
- CREATE OR REPLACE preserves signature, SECURITY DEFINER, empty search_path, owner, ACL, result and business logic.
- Apply tool checks other function definitions, table/index metadata, columns, RLS policies and existing data fingerprints before/after. Only function body and migration history change.

## Validation

- npm test: PASS, 175 tests.
- npm run typecheck / lint / build: PASS.
- git diff --check: PASS.
- test:isolated:upload-sql: PASS, 13 scenario groups plus exact eight-only body change/contract/ACL/idempotent reapply checks.
- test-upload-worker-entrypoint.mjs: PASS, actual local HTTP/parser.
- check-upload-build.mjs: PASS, native tracing/assets/CSP/anonymous denial.
- test-upload-db.mjs: PASS, dev transaction normal/stale/expired/fail-retry/reuse/idempotency/RLS; all synthetic DB data rolled back. First concurrent run's preservation check failed while this agent's separate smoke was modifying its own synthetic data; sequential rerun passed.
- test-upload-storage.mjs: PASS, real dev authenticated/signed upload, ownership/foreign/anonymous/path/overwrite/delete boundaries, production Original handler/Library/Detail. Exact synthetic objects/users removed.
- verify-upload-dev.mjs: PASS, exact current body and migration history/ACL.
- test-upload-cpu-live.mjs: PASS, one synthetic image through signed Storage, production prepare/parser, actual Tesseract.js 7 kor+eng OCR, complete/reuse, real Gemini schema validation/persistence. Stale direct PostgREST request returned HTTP409/PT409/STALE_ATTEMPT in 43ms with one client request. Synthetic object/account removed.
- test-upload-regression.mjs: NOT RUN; 해당 도구는 기존 Google Drive 원문을 다시 수집하는 live collector이며 Upload 함수 오류 처리 수정과 무관한 원본 수집/저장을 확장하지 않았다.
- Actual browser UI/cookie E2E: NOT RUN. OCR used the actual pinned engine via a Node driver; production service modules used a real synthetic authenticated principal adapter.
- verify-upload-stored-reads.mjs: NOT VERIFIED: legacy harness requires exactly one connected Google account; current dev has two. Did not alter connections or collect Google data to satisfy the fixture. No existing Google data mutation in this fix.

## Phase 1 production and review (historical)

No commit/push/Vercel deploy or compute upgrade performed. Existing pre-task README edits preserved.
IMPORTANT: production site's public client bundles point to the same oclzdppdiljbojvqtkeu project. Dev-only project mutation therefore also affects the DB used by the existing production site. “Production unchanged” is true only for the deployed frontend/server artifact and other projects, not the shared DB.
Existing deployed Upload server maps only 40001. PT409 mapping is local and awaits approval to commit/deploy; until then a stale request may surface as STORAGE_UNAVAILABLE/503 in the deployed app. Normal success path smoke passed against dev.
Other six application-level 40001 functions require a separate tested change before the overall risk can be considered fully removed.

Dev DB applied: YES
Retry storm stopped: YES (관찰한 5분 구간).
- 기준: 적용 확인 시각 10:21:55 KST. 직전 10:16:55–10:21:55 STALE_ATTEMPT 27,250건, 이후 10:21:55–10:26:55 1건.
- 반복 오류의 마지막 시각: 10:21:27.564 KST. 이후 1건: 10:22:55.443 KST, 의도적으로 보낸 stale smoke 요청 시각과 일치.
- request setup 누적 호출은 10:23:05의 393,626,010에서 10:26:58의 393,626,014로 4회 증가에 그쳤고, 두 시점 모두 대기 없는 active DB query 0건.
- 이 결과는 해당 구간의 retry storm 중단을 검증한다. CPU 사용률 자체의 하락이나 미래 재발 부재를 의미하지 않는다.
CPU percent: NOT VERIFIED (no infrastructure CPU metric acquired).
Commit: NO
Push: NO
Production frontend/server deploy: UNCHANGED
Production shared DB: upload error handling changed as described above

## Approved Production rollout

2026-10-10 사용자가 Upload CPU fix만 commit/main 일반 push 및 Vercel CLI Production 1회 배포를 승인했다. 나머지 6개 함수는 이번 단계에서도 변경하지 않는다.
최종 pre-deploy 검증은 HTTP route 수준의 PT409→409 테스트를 추가해 npm test 176개 및 typecheck/lint/build/diff-check/격리 Upload SQL이 모두 PASS다.
`UPLOAD_PRODUCTION_SMOKE=YES node tests/test-upload-production-smoke.mjs`는 합성 계정의 실제 SSR 세션 쿠키로 운영 HTTP create/prepare/complete/reuse/analyze/ITEM GET을 호출한다.
OCR은 실제 Tesseract.js kor+eng의 로컬 Node driver로 수행하며 브라우저 UI/Worker E2E 성공을 주장하지 않는다. 원본·계정은 정확한 합성 대상만 정리한다.
운영에서는 stale 오류를 의도적으로 생성하지 않는다. 서버 매핑은 route regression과 배포 commit으로 검증하고 운영 로그의 503 오매핑을 확인한다.
배포 후 smoke 증거는 ignored `supabase/.temp/upload-cpu-production-result.json`, 최종 배포·로그 결과는 채팅 최종 보고에 남긴다. 기존 README 보강은 제외한다.
