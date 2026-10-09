# SQL 기준 파일과 개발 DB Migration 이력

2026-10-05 기준. 대상은 개발 프로젝트 **ai-hub-dev**, project ref `oclzdppdiljbojvqtkeu`다. Production 적용 기준을 확정하는 문서가 아니다.

## 디렉터리 구분

- `baseline/`: 초기 remote DB 구성을 설명하는 SQL 보관본이다. SQL 내용과 기존 remote-only 이력은 유지하며 CLI 자동 적용 Migration이 아니다.
- `migrations/`: 이후 변경 Migration이다. 현재 이 폴더만으로 빈 DB의 전체 초기 상태를 재현할 수 있다고 보장하지 않는다.
- 아래 표와 코드 블록의 `supabase/baseline/` 경로는 repository root 기준이다.

## 역할과 적용 순서

| 순서 | 현재 보관 파일 | 파일 기준 버전 | 개발 DB history version | history name | CLI local/remote |
| --- | --- | --- | --- | --- | --- |
| 1 | `supabase/baseline/0001_initial_schema.sql` | v0.5 REVIEW | `20261003103041` | `initial_schema_v05` | remote only |
| 2 | `supabase/baseline/0002_db_optimization.sql` | v0.1 | `20261003104321` | `db_optimization_v01` | remote only |
| 3 | `migrations/20261004045936_google_data_oauth_token_storage.sql` | Phase 4 수정본 | `20261004045936` | `google_data_oauth_token_storage` | local/remote 일치 |
| 4 | `migrations/20261004115419_persist_gmail_item_analysis.sql` | 승인된 Phase 6A RPC | `20261004115419` | `persist_gmail_item_analysis` | dev 적용 및 history 등록 |
| 5 | `migrations/20261004145244_google_drive_oauth_scope_boundary.sql` | 승인된 Drive-3 Scope 경계 | `20261004145244` | `google_drive_oauth_scope_boundary` | dev 적용 및 history 등록 |
| 6 | `migrations/20261005013202_persist_drive_item.sql` | 승인된 Drive-3 ITEM RPC | `20261005013202` | `persist_drive_item` | local/remote 일치, dev Runtime PASS |

Phase 6A 순서 4는 기존 테이블·Evidence trigger·AI 분류 RPC에 의존하며 테이블 구조는 변경하지 않는다.
승인 후 ai-hub-dev에 해당 SQL만 실행했고 해당 version만 applied history로 등록했다.
`SECURITY DEFINER`, 빈 search_path, service_role 전용 EXECUTE이며 실제 권한과 합성 transaction/rollback 검사를 수행했다.
이 단계에서 기존 SQL 및 다른 migration history는 변경하지 않았다.

초기 Schema → Optimization → Token Storage 순서로 의존한다. 순서 3은 기존 `public.connections` 등 초기 테이블에 의존한다. baseline/의 SQL 두 파일은 CLI가 자동 발견하는 `supabase/migrations` 파일이 아니다.

순서 3은 SQL Editor로 적용한 뒤 이전 Phase 4 작업에서 `migration repair --status applied`로 history를 등록했다. 2026-10-04 이번 정리에서는 `migration list --linked`와 `schema_migrations`의 version/name을 읽기 전용으로 재확인했으며 SQL 실행, repair, DB 변경을 하지 않았다.

## 보관본과 적용 이력의 관계

- 초기 파일의 `v0.5 REVIEW`와 Token Storage의 `DRAFT ONLY` 주석은 작성 당시 표시다. 이번 정리에서 기존 SQL 내용을 변경하지 않았으므로 현재 적용 여부는 위 history 기록으로 판단한다.
- 초기 Schema와 Optimization은 이력 SQL과 **문자열 리터럴을 보존한 SQL 토큰 비교에서 일치**했다. 비교에서는 주석, 공백, 최상위 BEGIN/COMMIT wrapper를 제외했으며 원격 SQL은 메모리에서만 다루고 출력·저장하지 않았다. 단순 공백 축약만으로는 초기 Schema의 연산자 주변 형식 차이가 남아 추가 토큰 비교를 수행했다.
- 원본 byte hash는 주석·줄바꿈·형식까지 포함하므로 서로 다르다. 토큰 비교는 현재 DB Schema의 일치나 Runtime 검증을 대신하지 않는다.
- Token Storage는 history version이 local/remote 양쪽에 존재함을 확인했다. history 등록은 원본 파일 전체의 byte 일치나 실제 Schema를 증명하는 검사가 아니며, 실제 Schema/RPC 권한/Runtime 검증은 Phase 4 기록을 따른다.

현재 Windows 작업 사본의 byte 기준 SHA-256이다. Git의 CRLF/LF 정규화나 다른 OS의 checkout에서는 byte hash가 달라질 수 있으며, 줄바꿈 차이를 SQL 변경으로 단정하지 않는다.

```text
supabase/baseline/0001_initial_schema.sql
C4F9F38EE8D8CEF7DE403F8BBBE2BCDB43B68898ADD52A2115EC809D91B6B555

supabase/baseline/0002_db_optimization.sql
365A0B876FE45D7B46B49A2916B384A4433B09ABE3931EB366C7F0656FB9A614

20261004045936_google_data_oauth_token_storage.sql
41D56D2AE77682C6E91494F26A827FEB0360B38475164F8D3F4AC82BD9DC6289
```

## 현재 재현 범위와 남은 항목

현재 `supabase/migrations`만으로 빈 DB를 처음부터 생성하는 전체 체인은 준비되지 않았다. 초기 두 version이 remote only인 상태는 알려진 제한이며 local/remote 전체 일치로 보고하지 않는다.

팀 합류 후 새 개발 DB가 필요하면 확인된 초기 적용 SQL과 보관본을 바탕으로 local baseline 구성 방법을 승인한 뒤 재현 체인을 준비한다. 검토 없이 기존 보관본을 timestamp 이름으로 복사하거나 새 version으로 재적용하지 않는다. 기존 ai-hub-dev를 맞추기 위해 history를 삭제하거나 SQL을 재실행하지 않는다.

## 읽기 전용 확인 명령

Supabase CLI가 인증되어 있고 올바른 개발 프로젝트에 linked되어 있는 환경에서 실행한다. DB 비밀번호나 Secret을 명령 문자열·문서에 넣지 않는다.

```bash
npx --yes supabase@latest migration list --linked
npx --yes supabase@latest db query --linked "select version,name from supabase_migrations.schema_migrations order by version"
```

SQL/RPC Runtime 검증과 Google/Gmail 실연결 테스트는 `../scripts/README.md`, 상세 제품·구현 기준은 `docs/SPEC.md`를 따른다.

## Drive-3 Scope / ITEM RPC 적용 (2026-10-05)

- `migrations/20261004145244_google_drive_oauth_scope_boundary.sql`: ai-hub-dev 적용/history 등록 완료.
  기존 upsert Scope 허용 목록·축소 방지와 새 upgrade/guarded refresh 함수만 포함한다. 기존 table/column/index/RLS 변경 없음.
- `migrations/20261005013202_persist_drive_item.sql`: 별도 승인 후 신규 1건만 dev 적용 및 해당 history 등록. 승인 초안은 `../tests/fixtures/sql/drive/persist_drive_item.sql`에 보관한다.
- 두 파일 SQL/PLpgSQL 파서 구문 및 보안/lock/CAS 정적 검사 PASS. ITEM RPC 적용 전/후 합성 transaction/rollback Runtime PASS.
- Scope SQL은 적용 전 DDL+합성 데이터 transaction/rollback, 적용 후 합성 transaction/rollback 모두 PASS.
  service_role 전용 권한, 거절 시 원자 보존, Gmail checkpoint, stale snapshot/CAS, downgrade 금지, refresh, disconnect 차단 확인.
  다중 세션 경합 및 실제 Google 추가 동의는 별도이며 합성 검사로 대체하지 않는다.
- 적용 전후 기존 connections/tokens/ITEM/Classification/Action/Evidence와 table/column/index/RLS 및 기존 history의 hash가 동일했다.
  Scope 적용 당시 ITEM RPC는 부재였고, 이후 별도 승인으로 ITEM RPC 신규 한 건만 적용했다. 기존 history 수정/delete/reset 또는 다른 Migration 재적용은 하지 않았다.
- ITEM 적용 후 본문·service_role 전용 권한·SECURITY DEFINER·빈 search_path 및 local/remote 신규 version 일치 확인.
  소유권/활성 연결/Scope/Token/create/reuse/update/source stale/ITEM CAS/hash/size/분석·override 보존/RLS/disconnect Runtime PASS.
  적용 후 Runtime도 전체 rollback했으며 기존 실제 데이터·스키마·constraint·trigger·기존 함수·기존 이력은 전후 hash 동일.
  모든 local version은 remote와 일치하고 초기 2건 remote-only 상태는 유지했다. 전체 baseline 체인 일치로 확대 해석하지 않는다.
  기존 Migration 파일 수정 없음. 실제 Docs E2E 전에 사용자 요청으로 대기한다.

## Calendar-2 — 로컬 함수 Migration 초안 / 원격 미적용

- `migrations/20261005055748_google_calendar_scope_boundary.sql`: 기존 upsert에 Calendar readonly Scope/상한 9/권한 축소 방지 추가,
  새 `upgrade_google_calendar_scopes`로 owner/account/active connection/connection 및 token CAS/전체 checkpoint·timestamp 보호.
- `migrations/20261005055754_persist_calendar_item.sql`: 새 service_role 전용 Calendar ITEM 저장 함수.
  기존 identity index 사용, connection→ITEM lock, whitelist/hash/date/CAS/stale 검증, 취소의 기존 정상 콘텐츠 보존.
- Supabase CLI migration new로 파일 생성. `tests/fixtures/sql/calendar`의 두 검토 SQL과 동일하다.
  기존 Migration/table/column/index/RLS 수정 없음. **ai-hub-dev 및 Production 미적용, 신규 history 등록 없음.**
- pglast 8.5 SQL/PLpgSQL 파서와 정적 안전 검사 및 메모리 PostgreSQL 합성 검증을 수행한다.
  실제 Supabase RPC/RLS/다중 세션 경합 검증은 Calendar-3 승인 후 별도로 수행한다.
- 사용자 승인 전 db push/apply_migration/history repair/reset 금지. 새 로컬 version이 pending인 것은 현재 의도된 상태다.

Calendar-3 승인 후 위 두 Migration은 ai-hub-dev에만 적용/history 등록했다. 위 미적용 문장은 Calendar-2 당시 이력이다.
원격 함수 본문/보안/권한 및 version/name/statements의 로컬 일치 PASS. 기존 초기 2건 remote-only 이력은 유지했다.
기존 데이터/Token/Schema/RLS/constraint/trigger/기타 함수/기존 history hash 동일, 합성 Runtime/RLS 전체 rollback PASS.
실제 OAuth/Event E2E는 격리 검사와 구분한다. 실행 절차는 `docs/setup/E2E_CHECKLIST.md`를 따른다.


## Upload-2 — 로컬 SQL/Storage policy 초안 (원격 미적용)

`migrations/20261005070410_upload_storage_session_boundary.sql` 하나만 새 로컬 초안이며
`../tests/fixtures/sql/upload/20261005070410_upload_storage_session_boundary.sql` 검토본과 동일하다.
private.upload_sessions RLS/service_role 전용 RPC, 사용자별 upload UUID/raw hash unique index,
private 5MB/MIME bucket 및 exact-session-path INSERT/SELECT 정책을 정의한다. authenticated UPDATE/DELETE 없음.
짧은 global/user advisory lock·원본 hash dedupe·Idempotency-Key·pending/lease/CAS/원자 완료/실패/정리 경계를 포함한다.
기존 Migration 수정, 원격 적용/history 등록, bucket 생성 및 Storage policy 변경은 하지 않았다.

pglast 8.5 SQL AST 및 PL/pgSQL 구문 PASS(오프라인 catalog rowtype는 record로 표현).
임시 PostgreSQL/WASM 실제 draft SQL 실행으로 owner/RLS/권한/dedupe/예약/원자 실패/완료/정리를 검증했다.
실제 Supabase Storage API token/upsert 의미·원격 RLS·다중 프로세스 경합/worker 배포는 Upload-3에서 별도로 검증한다.
초안의 session table/index/bucket/policy 생성은 실제 구조 변경이므로 사용자 승인 전 db push/apply/history 등록 금지.


Upload-3 사용자 승인 후 `20261005070410` 한 건을 ai-hub-dev 적용/history 등록했다.
Upload-2의 미적용 문장은 당시 이력이다. 기존 object/data/Token/분석/이력 보존 및 actual RPC/RLS
합성 transaction/rollback, Storage HTTP owner/foreign/anon/path/private/upsert/no-overwrite 검증 PASS.
기존 초기 두 remote-only Migration을 유지하고 history repair/reset은 하지 않았다.
위 ADC/private parser worker 대기 조건은 이전 정책의 이력이다. 현재는 browser OCR MVP이며 전체 Upload COMPLETE다.
실행 조건은 `docs/setup/UPLOAD_RUNTIME_SETUP.md`를 따른다.

`20261005093526_upload_provider_neutral_rpc.sql`은 **사용자 승인 후 ai-hub-dev 적용 완료**다.
기존 upload_session_rpc 한 함수와 service-only EXECUTE 권한만 정의한다. 새 table/column/index/policy/bucket 없음.
provider-neutral origin whitelist/NFC/range 검증, 미완료 dedupe 거절, expired running snapshot/CAS 복구를 포함한다.
SQL/PLpgSQL parser 및 ephemeral PostgreSQL 13 checks PASS. 적용된 Migration/draft는 수정하지 않았다.
승인된 한 건만 적용/history 등록했으며 기존 데이터/Storage/RLS와 초기 두 remote-only history를 보존했다.
local/remote history, 함수 본문 및 service-only 권한 검증 PASS. 적용된 Migration 파일은 수정하지 않는다.

## Search-2 — ai-hub-dev 적용 완료

`migrations/20261005113838_search_contract_and_rpcs.sql` 한 건을 사용자 Search-2 지시에 따라
read-only preflight 후 ai-hub-dev에 적용하고 history 등록했다. Production에는 적용하지 않았다.
파일의 local draft 주석은 작성 시점 기록이며 현재 상태는 적용 완료다. 적용된 SQL 본문은 수정하지 않는다.

pgvector 0.8.2/기존 embedding 0건을 확인한 뒤 embedding을 vector(768)로 고정했다.
version별 ITEM/chunk unique, locator/hash/fingerprint, private job/rate/query cache/snapshot 및
service_role 전용 search_runtime/search_index/search_candidates/search_similar RPC를 추가했다.
RLS와 owner 검증을 유지하고 authenticated의 raw embedding SELECT 및 새 RPC EXECUTE를 차단했다.
private 테이블은 RLS enabled, client policy 없음, client GRANT 없음이며 service_role만 사용한다.
Supabase advisor의 RLS enabled/no policy INFO는 이 의도된 서버 전용 경계다.

적용 후 원격 함수 본문/history/권한과 로컬 Migration 일치 PASS.
기존 ITEM/분류/Action/근거/연결/Token 데이터 해시 동일. 새 chunk/job/cache/session 0건 유지.
Migration 적용으로 실제 embedding 호출이나 개인 데이터 backfill은 시작되지 않는다.
개인 전체 backfill은 별도 승인 필요하며 CLI runner를 자동 실행하지 않는다.
Ephemeral PostgreSQL/pgvector 실제 SQL 8 checks PASS. 원격 HTTP E2E와 실제 semantic 품질은
별도 실연결 검사이며 `../docs/setup/SEARCH_VALIDATION.md`를 따른다.

Search-3의 `20261005115533_search_coverage.sql` 및 `20261005121340_search_rank_ties.sql`은 dev 적용 완료다.
전자는 service-only owner corpus coverage, 후자는 exact-title 및 keyword source-date/ID tie-break만 보완한다.
원격 history와 public column/기존 RLS/owner 경계를 확인했다. 적용된 SQL은 변경하지 않는다.
검색 검증 경계와 합성 query 기준은 `docs/setup/SEARCH_VALIDATION.md`를 따른다.
