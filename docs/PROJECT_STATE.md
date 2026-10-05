# PROJECT_STATE — 새 Codex 채팅 인계

최종 갱신: 2026-10-05 (Asia/Seoul)
프로젝트: `C:\Users\MYCOM\ai_hub`
현재 상태: **기존 Phase 1~6A/6B 및 Drive/Calendar/Upload/Search COMPLETE 유지. Polished UI 2.0 통합 구현·실제 Browser 검증 완료, 전체 MVP NEEDS_BACKEND_FIX.**
현재 허용 범위: 사용자 신규 요청으로 Final Integration UI 작업을 진행했다. 최신 결과·제약은 18절 및 docs/POLISHED_UI_2_REPORT.md를 따른다. DB schema 변경/개인 semantic backfill/Notion 수정 미실행. 전체 MVP는 Backend GAP 해소 전 미완료.

## 1. 기준과 작업 원칙

- 제품 기준: Notion 「AI 통합 정보 허브 — 서비스 기획 및 개발 기준서 v0.5」 → 루트 `SPEC.md` → `README.md`.
- API: 기존 조회 `API_SPEC.md` 23절, Search 계약 25절. AI 분석: 루트 `AI_OUTPUT_SPEC.md` / `AI_OUTPUT_SCHEMA.json` v0.2.
- 이 문서는 진행 상태 인계 기준이며 제품 명세를 대체하지 않는다. `docs/SPEC.md` 참조 및
  SPEC/README의 초기 단계 번호·진행 표시는 오래된 기록이다. 현재 진행 판정은 이 문서를 따른다.
- COLLECT / FIND / ACT 및 Unified ITEM 원칙을 유지한다. Google 원본은 삭제하지 않는다.
- User Edited > AI. 날짜만으로 Action을 만들지 않고 행사일/신청 시작일/마감일을 구분한다.
  원문에 없는 날짜·행동·조건·요구사항·Evidence를 추론하지 않는다.
- 확정 스택을 유지한다: Next.js/TypeScript/Tailwind/shadcn, Supabase PostgreSQL/Auth/Storage,
  pgvector, Google OAuth/API, Gemini/Embedding, Cloud Run/PubSub, Vercel.
  스택 포함을 구현 완료로 해석하지 않는다.
- Phase 6B에서는 UI/UX·화면 구성·새 컴포넌트를 구현하지 않았다. Search/Embedding/Drive/Calendar/
  Upload/Worker/자동 동기화 및 다음 Phase 구현을 시작하지 않았다.

## 2. Phase 1~5 COMPLETE

| Phase | 완료 범위 |
| --- | --- |
| 1 | Supabase 기본 연동·서버 인증 기반·연결 검사 |
| 2 | Google 서비스 로그인·callback·세션·보호 route·Shell·logout |
| 3 | Unified ITEM Library/Detail 읽기와 사용자 접근 경계 |
| 4 | 별도 Google Data OAuth·암호화 Token 저장/refresh·disconnect/재연결 |
| 5 | Gmail 초기 수집·본문/header/첨부 metadata 파싱·ITEM 중복 방지·Library/Detail 연결 |

서비스 로그인은 Supabase Auth이며 Gmail Data OAuth와 별도다.
Gmail 초기 수집 기준: `in:inbox newer_than:30d`, 최대 100 messages. 현재 저장 Gmail 46건.
identity: external_id=messageId, external_container_id=NULL, metadata.threadId=threadId.
첨부 binary 다운로드는 구현하지 않았다. Phase 6B에서는 Gmail API 재수집을 수행하지 않았다.

## 3. Phase 6A COMPLETE — 사용자 최종 판정 유지

- 실제 Gmail ITEM 2건의 Gemini → v0.2 validation → DB 저장 E2E PASS.
  Action 1개 사례와 Action 0개 사례 모두 PASS. 두 저장 결과의 eventObservations는 빈 배열.
- Classification + Action + Evidence + items.metadata.aiAnalysis를 서버 전용
  `persist_gmail_item_analysis` RPC 단일 transaction으로 저장한다.
- metadata.aiAnalysis: schemaVersion/model/inputFingerprint/analyzedAt/검증된 result.
  기존 Gmail metadata는 보존한다. schemaVersion="0.2", Action description은 사용하지 않는다.
- Classification ai_*만 갱신하며 user_*와 기존 Action 완료 상태를 보존한다.
- 전체 Schema·의미·원문 인용·Unicode code point 위치·날짜 역할을 저장 전에 검증한다.
  모든 인용 및 시작/마감 관찰값은 action_sources.evidence_locator에 보관한다.
- 동일 ITEM/본문 fingerprint/모델/버전은 캐시 재사용. 원자 저장·idempotency PASS.
  모호한 재매칭/사라진 후보는 자동 증식·삭제 대신 검토 오류. Cross-ITEM 의미 병합은 미확정.
- 분석 성공 processing_status는 indexing이다. 검색/Embedding 완료를 의미하지 않는다.
- 합성 개발 DB 검증: user override 보호, 실패 전체 rollback, 소유권/권한/경합/stale input PASS.
  합성 event-date/deadline 분리 및 no-action PASS.
- 실검증 이력은 성공 2건 / 실패 1건 / 미실행 2건이다. 성공 2건을 근거로 사용자가 COMPLETE를
  확정했으며 최대 5건은 호출 상한이다. 실패/미실행을 PASS로 바꾸거나 종료 조건으로 재요구하지 않는다.
- 과거 Gemini 503과 HTTP 응답 없는 GEMINI_UNAVAILABLE는 외부 서비스 이슈 기록이다.
  출력 validation 실패는 저장을 차단했다. 불명확한 네트워크 오류 원인은 확정하지 않는다.
- 기존 retry: 429/503만 최초 포함 최대 3회, 전체 120초, Retry-After 존중.
  10초 초과 대기는 요청 내 수행하지 않음. validation/기타 HTTP/불명확한 네트워크 오류 자동 retry 없음.
  모델 자동 변경 금지.

### 실제 event-date 회귀 TODO

Phase 6A에서 저장 Gmail 전체 46건의 제목/본문을 읽기 전용으로 검색했으나 적격 행사/회의/시험/
면접/방문/예약/교육/설명회/세미나/결과 발표일 사례가 없었다. 로그인 발생일은 대체 샘플이 아니다.
**실제 샘플 없음 — 향후 회귀 항목이며 COMPLETE를 되돌리는 blocker가 아니다.**
향후 적격 ITEM이 저장되고 사용자가 실행을 지시하면 해당 1건만 검증한다. 기존 고정 목록을 추가
호출하거나 새로운 Gemini 호출로 샘플을 만들지 않는다.

## 4. Phase 6B COMPLETE — 계약·조회 연결·통합 검증

목표: Phase 6A 저장 결과를 기존 ITEM 조회 API/데이터 계약에 연결해 프론트엔드가 안정적으로 읽게 한다.

### 6B-1 COMPLETE / 사용자 PASS 승인

- `src/types/items.ts`: Item, Classification, AI/User/EffectiveClassification, Action,
  ActionSource/Evidence, EventObservation, AIAnalysis, ItemDetailResponse 계약.
- 기존 DB/분석 타입과 effectiveClassification 반환 타입 재사용.
- 기존 소비자와의 컴파일 호환성 검사 및 API_SPEC 23절 계약 확정.

### 6B-2 COMPLETE / 사용자 PASS 승인

- 기존 `getItemDetail()`을 ItemDetailResponse에 연결. 기존 GET route가 그대로 반환한다.
- 기존 item/classification/actions/evidence/processing/gmail/original 필드 유지.
- aiClassification/userClassification/effectiveClassification 추가. 기존 최종값 함수를 재사용하고
  사용자 필드 null은 override 없음, tags=[]는 명시적 제거로 보존한다.
- 기존 actions의 requirements/conditions/startDate/startAt/completedAt 및 status/deadline을 조회한다.
  AI 후보나 eventObservations에서 Action/마감일을 만들지 않는다.
- action_sources의 observedDeadlineDate/observedDeadlineAt을 매핑하며 current/history를 유지한다.
  locator 중첩까지 허용 key로 재구성하고 내부 analysisKey/임의 key는 제거한다.
- metadata.aiAnalysis.result를 기존 로컬 v0.2 validator 및 현재 원문으로 검증한 뒤
  eventObservations와 schemaVersion/analyzedAt만 반환한다. 전체 metadata/result/model/fingerprint는 숨긴다.
- 분석 결과 없음/구조 오류/검증 실패는 aiAnalysis=null, eventObservations=[]로 처리해 Detail을 유지한다.
- requireUser/session client/user ownership/RLS 경계를 유지한다. Detail GET에 admin/service_role 없음.
- 목록 API, 기존 page/컴포넌트, Gemini client/validator/Schema/Prompt/저장 RPC는 변경하지 않았다.

### 6B-3 통합 검증 PASS (2026-10-04)

대상은 개발 프로젝트 **ai-hub-dev**이며 실제 DB는 SELECT 전용 transaction으로 조회했다.

| 검사 | 결과 / 실제 검증 범위 |
| --- | --- |
| 현재 저장 데이터 | Gmail 46건, v0.2 분석 2건, Action 연결 ITEM 1건, 분석 no-action ITEM 1건, 분석 metadata 없음 44건 |
| 실제 Detail 사례 | 서로 다른 ITEM 3건으로 분석/Action 있음/Action 없음/분석 전 네 가지 사례 PASS |
| 실제 연결 검증 | RLS 적용 snapshot → production getItemDetail/GET handler의 read-only auth/transport adapter 실행 및 JSON 응답 검사 PASS |
| Action/Evidence | 실제 Action 1건, Evidence 1건의 DB 값·관계·원문 인용·관찰 deadline·중복 없음 PASS |
| Classification | 실제 AI-only 최종값 PASS. 실제 override 0건; User 우선/빈 tags는 합성·격리 PASS |
| Deadline | 실제 Action none/null 유지 PASS. 확정 마감일·시작일 분리는 합성 PASS |
| EventObservation | 실제 저장 관찰값 0건. event-only/needs_review/Evidence/날짜 분리는 합성 PASS. Phase 6A 실제 샘플 없음 TODO 유지 |
| RLS | items/classifications/actions/action_sources RLS enabled 및 실제 authenticated 역할의 소유 데이터 조회 PASS |
| 다른 principal | 다른 실제 사용자 계정 없음. DB 행 생성 없이 synthetic authenticated sub로 같은 실제 DB에서 타 소유 데이터 0건 및 handler 404 PASS |
| anon DB | items SELECT는 테이블 권한으로 거부. 권한/정책 변경 없이 차단 확인 |
| 미인증 HTTP | 로컬 production 서버에서 ITEM 목록/Detail/connections 401, Library 로그인 redirect PASS |
| 보안 | 실제 응답의 중첩 허용 key·raw metadata/result/internal key/로컬 Secret 값 비노출 PASS. browser static 17개 파일 Secret 실제 값 일치 0건 |
| 데이터 불변 | 검증 전후 소유 ITEM/Classification/Action/Source/Connection snapshot 동일 PASS |
| 회귀 | 기존 auth/세션/보호 route/logout·재로그인/Gmail/연결/Library/Detail mock·저장 데이터 검사 PASS |
| 품질 | npm test 52개 / typecheck / lint / build / check:supabase / git diff --check 전부 PASS |

검증 한계: 위 SQL authenticated principal 및 auth/transport adapter 검증은 실제 Browser cookie
세션으로 인증한 HTTP E2E를 대신하지 않는다. 이번에는 Google OAuth/실제 세션 refresh/logout·재로그인을
재실행하지 않았으며 기존 격리 검증을 사용했다. 실제 타 사용자 계정/override/event-date 샘플을
임의 생성하지 않았다. 없는 실사례를 실제 PASS로 기록하지 않는다.

Supabase Auth 검사의 최초 EACCES는 로컬 sandbox 네트워크 차단이었다. 네트워크 허용 실행에서
check:supabase PASS. Supabase MCP 인증은 사용할 수 없어 기존 인증된 CLI 읽기 경로를 사용했다.
검증 도구의 Windows 파일 인자와 anon 권한 거부 판정만 정정했으며 제품 코드·정책은 수정하지 않았다.

Phase 6B 전체: **DB 데이터/Schema/RLS/Migration/history 변경 없음. Gemini 호출 0회.
Google API 재수집 0회. 신규 라이브러리·API 기능·UI 구현 없음.**
6B-3의 영구 변경은 API_SPEC.md / SPEC.md / 이 문서에 한정한다.

## 5. Migration 이력 및 기존 제약

개발 프로젝트 ref: `oclzdppdiljbojvqtkeu`. Production 작업은 승인되지 않았다.

| Migration | 상태 |
| --- | --- |
| 20261003103041 initial_schema_v05 | 기존 remote-only 이력; 보관 SQL `0001_initial_schema (4).sql` |
| 20261003104321 db_optimization_v01 | 기존 remote-only 이력; 보관 SQL `0002_db_optimization.sql` |
| 20261004045936 google_data_oauth_token_storage | local/remote 일치 |
| 20261004115419 persist_gmail_item_analysis | dev 적용 완료, 해당 local/remote history 일치 |

Phase 6A RPC는 SECURITY DEFINER/search_path=''/service_role 전용 EXECUTE이며 기존 테이블 구조를 유지한다.
전체 history 일치나 빈 DB 전체 재현 체인 완성을 뜻하지 않는다. 적용 순서·보관본 관계는
supabase/README.md를 따른다. 기존 Migration 수정/재실행, history repair/delete를 임의 수행하지 않는다.

기존 npm audit high 8건은 별도 Warning이며 force upgrade 금지. 기존 Security advisor의
authenticated SECURITY DEFINER / leaked password protection 경고도 별도 항목으로 유지한다.
Phase 6B blocker는 없다. 회귀 TODO 및 Browser E2E 미재실행 범위는 위 검증 표와 구분한다.

## 6. 다음 채팅 시작점과 금지사항

1. Phase 1~6A 및 Phase 6B COMPLETE를 유지한다. 다음 단계 명칭·목표·범위는 아직 별도 확정 전이다.
   사용자 지시를 받고 관련 명세/영향 파일/실행 계획을 확인한 뒤 시작한다. SPEC의 초기 Phase 번호를
   현재 Implementation 단계와 자동 대응하지 않는다.
2. 다음 Phase 구현은 이 완료 기록으로 승인되지 않는다. Search/Embedding/Drive/Calendar/Upload/
   Actions 독립 화면/D-Day/분류 수정 API/UI 재설계 등을 임의 시작하지 않는다.
3. 기존 미커밋 작업을 삭제하거나 되돌리지 않는다. Phase 6A/6B 코드·명세·테스트·RPC Migration,
   특수 문자가 포함된 README 유사 파일과 next-env.d.ts를 보존한다. 자동 commit/reset하지 않는다.
4. Secret/API Key/Token/JWT/환경변수 실제 값/이메일/ITEM ID/messageId/본문 개인정보를 출력하지 않는다.
   .env.local 및 supabase/.temp/phase6a-selection.json은 Git-ignored다. 고정 목록 내용을 출력하지 않는다.
5. 추가 Gemini 호출·Gmail 재수집·첨부 binary 다운로드·DB/정책/Migration 변경·Production 적용·
   Notion v0.5 원본 수정은 승인 없이 수행하지 않는다. service_role은 일반 Detail 조회에 사용하지 않는다.

테스트는 scripts/README.md를 먼저 읽는다. npm test는 외부 호출/DB 쓰기 없는 격리 검사다.
test:live:analysis는 Gemini 및 실제 DB 저장, test:live:analysis-db는 합성 DB 쓰기 후 rollback,
test:live:google-refresh는 실제 Token bundle 갱신이므로 이번 읽기 전용 검증에 사용하지 않았다.
기존 live analysis script는 고정 목록 전체 순회이므로 향후 1건 지시가 있으면 그대로 실행하지 않는다.

환경변수는 기존 구성 그대로다. SUPABASE_SECRET_KEY가 존재하며 대체 SERVICE_ROLE_KEY 미설정은
현재 blocker가 아니다. GEMINI/Google/Supabase 환경값은 인계 문서나 로그에 기록하지 않는다.

## 7. Drive-1/2 승인 및 Drive-3 인계 (2026-10-05)

Drive-1 COMPLETE / Drive-2 수정 승인. 확정 제품 범위는 SPEC.md 35절, OAuth/API 계약은 API_SPEC.md 24절을 따른다.
위 6절의 다음 단계 미확정 기록은 Phase 6B 종료 당시 기준이며 이번 Drive-3 승인으로 갱신됐다.

- 구현: 기존 Data OAuth에 drive_scope_upgrade 목적 추가. 서비스 로그인은 변경하지 않았다.
- 같은 Google 계정/연결 상태/실제 granted scopes 확인. Gmail/Drive 권한 축소·부분 동의·다른 계정·실패는 기존 bundle 저장을 차단한다.
- OAuth state에 목적/소유자/연결/계정/연결 수정시각/10분 만료를 HMAC으로 결합한다. 이전 형식의 진행 중 state는 안전하게 거부하므로 연결 요청을 다시 시작해야 한다.
- 신규/기존 Refresh Token으로 실제 반환 scope와 계정을 확인한 뒤 확장 bundle을 저장하는 서버 코드 구현. 실제 호출은 이번 작업에서 실행하지 않았다.
- Scope 추가 RPC는 Gmail sync_state/history_id/initial_collection/last_synced_at/connected_at 보존. Guarded refresh는 이전 ciphertext snapshot으로 신규 bundle을 덮어쓰지 못하게 한다.
- 기존 Gmail-only 최초 동의는 동일 Scope. 기존 Drive 권한이 있으면 일반 재연결에도 해당 권한을 요청해 우발적 축소를 막는다.
- Scope Migration: supabase/migrations/20261004145244_google_drive_oauth_scope_boundary.sql — 2026-10-05 ai-hub-dev 적용/history 등록 완료.
- persist_drive_item: supabase/migrations/20261005013202_persist_drive_item.sql — 별도 사용자 승인 후 ai-hub-dev 적용/history 등록 완료. docs/drafts/drive/persist_drive_item.sql은 승인 초안 보관본.
- 두 SQL 모두 PostgreSQL SQL/PLpgSQL 파서 구문 및 보안/lock/CAS 정적 검사 PASS. Scope와 ITEM RPC 실제 DB 실행·권한·합성 보존/거절/CAS 검증 PASS. 다중 세션 경합은 별도 미실행이다.
- 기존 52개 + Drive OAuth 10개 + 수집 13개 격리 테스트 PASS(총 75). typecheck/lint/build/check:supabase/diff 검사 PASS.
- 이번 후속 작업은 실제 개발 DB Scope 적용 및 적용 전/후 합성 transaction/rollback 검증을 수행했다.
  적용 전후 기존 connections/암호화 tokens/ITEM/Classification/Action/Evidence/table/column/index/RLS 및 기존 history hash 동일.
  Scope 적용 당시 persist_drive_item 부재를 확인했고 Scope version 한 건만 등록했다. 이후 별도 승인으로 ITEM RPC Migration 한 건을 추가 적용했다. Production 미적용.
  기존 Gmail 테스트 연결을 내부 식별해 실제 refresh 1회 및 profile PASS. 기존 Refresh Token/scopes/전체 sync_state/history_id/initial_collection/last_synced_at 보존 PASS.
  사용자가 동일 계정으로 추가 동의 완료를 확인했고, 기존 연결에 저장된 Gmail+Drive/Docs 두 Scope와 동일 계정/연결 및 전체 Gmail checkpoint 보존을 실제 조회해 확인했다.
  Gemini 호출 및 Google 동의 화면 설정 변경은 하지 않았다.

**배포/실행 주의:** 신규 RPC는 ai-hub-dev에만 적용 확인했다. 다른 환경 배포 시 동일 함수 적용을 먼저 확인한다.
Drive-3 COMPLETE. 수집 구현과 실제 검증은 모두 같은 Drive-3 범위에서 완료했으며 다음 Calendar 단계는 시작하지 않는다.
Drive client/Docs 추출/collect API 구현 및 13개 격리 검사 PASS. persist_drive_item 수정 초안 SQL/PLpgSQL 파서 재검증 PASS.
persist_drive_item 적용 전 DDL+합성 transaction/rollback, 적용 후 합성 RPC/RLS transaction/rollback PASS.
service_role 전용/SECURITY DEFINER/빈 search_path 및 원격 함수 본문과 신규 Migration 일치 확인.
user/connection 소유권·활성 연결·Scope/Token 확인, source=drive, create/reuse/update 동일 identity,
SHA-256/size 검증, stale source/ITEM·동일 version 충돌 거절, 실패 원자 보존, Classification/Action/Evidence/user override 및 disconnect 본문 보존 PASS.
적용·Runtime 이후 기존 connections/tokens/ITEM/분석/table/column/index/RLS/constraint/trigger/기존 함수/기존 history hash 동일. 합성 사용자 잔존 없음.
신규 Migration과 모든 기존 local version은 remote와 일치. 기존 초기 2건 remote-only 제한은 그대로이며 전체 baseline 체인 완전 일치로 보고하지 않는다.
신규 1건만 적용·이력 등록했고 기존 Migration 파일은 수정하지 않았다. 이후 아래 실제 Docs E2E를 완료했다.
Migration/Runtime 완료 후 멈췄으며 이후 사용자가 실제 Docs 1건 E2E 진행을 승인했다.
OAuth 실제 저장 상태 검증 PASS. 최초 metadata 조회의 HTTP 403 / SERVICE_DISABLED / accessNotConfigured는
사용자의 Drive/Docs API 활성화 완료 후 해소됐다. 추가 문서 탐색 없이 지정된 Google Docs 1건만 재검증했다.
실제 metadata → 모든 tab 텍스트 추출 → persist_drive_item 신규 ITEM 생성 PASS.
같은 문서 재수집은 동일 ITEM ID 재사용, identity count=1, 본문 다운로드 횟수 증가 없음 PASS.
Library/Detail 서버 조회 코드와 original_url 연결 PASS. 수집 전후 Gmail ITEM/connection Scope/전체 sync_state/
last_synced_at 및 기존 Classification/Action/Evidence graph hash 동일 PASS.
실제 저장 ITEM의 타 사용자 서버 조회 차단과 authenticated DB RLS의 소유자 허용/타 사용자 거부 PASS.
CLI auth/cookie adapter는 대체했고 실제 RLS는 별도 DB transaction/rollback으로 검증했다.
이번 검증은 Browser cookie 기반 collect HTTP/UI E2E를 재실행했다는 의미가 아니다.
실제 문서 수정/update는 원본을 변경하지 않아 미실행이며 update/SOURCE_CHANGED는 격리 및 RPC Runtime 검증을 따른다.
최종 npm test 75개/typecheck/lint/build/check:supabase/git diff --check PASS. 추가 Migration/Schema 변경 없음.
실제 Drive ITEM 1건만 신규 저장했으며 Google 원본 변경/추가 문서 수집/Gemini 호출은 없다. Drive 완료 blocker 없음.
문서 본문/계정/credential/raw error를 로그에 출력하지 않는다. Calendar는 진행하지 않는다.

TODO: drive.metadata.readonly Restricted Scope 상용화 검증 재검토, Vercel 실제 실행 제한 확인,
하위 폴더 탐색(후속 범위), Cross-ITEM Action 병합(Drive AI 분석 전 필수 결정).
Google Picker/drive.file/AI/Search/Embedding은 구현하지 않았다.

## 8. Calendar-1/2 승인 및 Calendar-3 인계 (2026-10-05)

사용자가 Calendar-1 권장안과 보완 조건을 승인하고 Calendar-2 구현을 지시했다.
위 Calendar 미착수/금지 기록은 해당 시점의 이력이며 현재 허용 범위는 이 절과 문서 상단을 따른다.
Calendar 단계는 Calendar-1 기준/Calendar-2 구현/Calendar-3 실제 검증 총 3개만 사용한다.
제품 계약은 SPEC.md 36절, API/Detail 계약은 API_SPEC.md 25절을 따른다.

- Calendar-1 COMPLETE. 동일 Google 계정 primary/calendar.events.owned.readonly/default 일반·초대 일정·occurrence만 승인.
  고정 실행 시작시각 -30일/+90일, singleEvents/showDeleted=true, pageSize 50/4페이지/200개.
- Calendar-2 구현: OAuth calendar_scope_upgrade/state/callback/실제 Scope 및 offline refresh 검증/기존 Scope 보존,
  Calendar client/validation/canonical text/ITEM 저장 호출/collect API/Detail calendar whitelist.
  서비스 로그인/UI/UX는 변경하지 않았다. 기존 Gmail/Drive 경로와 guarded refresh/disconnect를 유지한다.
- 신규 Scope Migration: supabase/migrations/20261005055748_google_calendar_scope_boundary.sql.
  기존 upsert 함수의 allowlist/Scope 축소 차단/상한 9 확장 및 새 Calendar upgrade 함수만 포함한다.
  전체 Gmail/Drive sync_state/last_synced_at/connected_at와 Token CAS를 보호한다.
- 신규 저장 Migration: supabase/migrations/20261005055754_persist_calendar_item.sql.
  owner/active connection/Scope/Token/Calendar identity/whitelist/hash/날짜/connection→ITEM lock/CAS/stale 검증.
  정상 create/reuse/update, unknown cancelled skip, known cancelled의 마지막 정상 본문/날짜/URL/분석 보존.
- 두 파일은 Supabase CLI migration new로 생성한 **로컬 초안**이며 docs/drafts/calendar의 검토본과 동일하다.
  **ai-hub-dev/Production 미적용. 신규 원격 Migration history 등록 없음. 기존 Migration 파일 수정 없음.**
  기존 table/column/index/RLS 및 사용자 데이터에 대한 쓰기는 수행하지 않았다.
- 날짜는 event date이며 Action deadline과 독립적이다. all-day를 UTC 자정으로 만들지 않는다.
  source created/updated 미제공은 null이다. 기존 변경에 필요한 source version 순서를 확인할 수 없으면 저장 거부한다.
  취소/복원은 이전 ITEM CAS를 잡은 뒤 fresh GET으로 확인하며 fresh GET 추가 상한은 20건.
  취소 updated가 없어도 임의 날짜를 만들지 않으며 해당 변경은 실패로 기존 정상 데이터를 보존한다.
  기간 밖 이동/목록 부재만으로 삭제·취소를 확정하지 않는다. syncToken/전체 변경 탐지는 후속 범위다.
- Calendar 수집에서 Classification/Action/Deadline/AI eventObservations 생성 및 Gemini 호출 없음.
  processing_status=queued는 자동 분석이나 검색 완료를 의미하지 않는다.
- npm test **103개 PASS**(기존 75개 + Calendar 28개), typecheck/lint/build/check:supabase/git diff --check PASS.
  check:supabase는 네트워크 허용 실행의 Auth settings 읽기 전용 검사이며 실제 DB/RLS/세션 검증이 아니다.
  일반 sandbox 실행의 연결 검사 실패 후 네트워크 허용 실행에서 PASS했다.
- pglast 8.5 두 Migration의 SQL/PLpgSQL 파서 PASS. 원격 DB 실행을 대신하지 않는다.
- 별도 메모리 PostgreSQL/WASM(PGlite) **10개 합성 SQL 검사 PASS**.
  기존 SQL에서 가져온 enums/connections/items/unique key/token/updated_at trigger를 사용하여 두 초안을 메모리에서만 실행했다.
  create/reuse/update/시간 변경/nullable source dates/all-day/occurrence/CAS/stale/hash/취소/owner/Scope/token/disconnect,
  Scope upgrade partial/foreign/stale 거부 및 실패 원자 보존/checkpoint/timestamp/refresh 보존/함수 EXECUTE 권한 PASS.
  user override/Action/Evidence는 최소 ancillary sentinel tables 보존 검사이며 실제 production RLS 구조를 재현했다고 보고하지 않는다.
  metadata.aiAnalysis 보존도 검사했다. 엔진은 메모리 전용, 파일 DB 생성/실제 Supabase·Google 접속/.env 접근 없음.
  SQL 정규식의 PostgreSQL 반복수 제한을 이 검사에서 발견하여 길이 검사+허용 문자 regex로 수정한 뒤 PASS했다.
  실제 Supabase RPC/RLS/다중 세션 경합/Browser cookie HTTP E2E는 Calendar-3에서 별도 검증한다.
- 임시 pglast/PGlite는 Git-ignored supabase/.temp 하위에만 설치했으며 제품 dependency/lockfile/스택에는 추가하지 않았다.
  ESLint는 해당 임시 경로를 제외한다. npm test는 임시 도구 없이 실행 가능하다.

**Calendar-2 COMPLETE. 구현 blocker 없음. Calendar-3 미착수 — 사용자 승인을 기다린다.**
Calendar-3 선행 조건: 두 로컬 함수 Migration 적용 승인 및 dev 적용/Runtime 검증,
AI Hub Dev Google Calendar API 활성화 확인, 동일 계정 Calendar 추가 동의, 사용자 지정 Event 1~3건 실제 E2E.
실제 Gmail/Drive Token/checkpoint/ITEM/분석 보존과 RLS/idempotency/조회 경계 및 최종 문서화를 확인한다.
Migration 미적용 상태에서 실제 Event 수집을 실행하지 않는다. 배포 maxDuration 지원 및 primary alias의 후속 정규화는 기록대로 유지한다.

## 9. Calendar-3 진행 이력 — 대기 상태는 10절 완료 판정으로 해소

사용자가 Calendar-2 PASS와 Calendar-3 실행을 승인했다. 8절의 미적용/미착수 문장은 승인 전 이력이다.

- 승인된 `20261005055748_google_calendar_scope_boundary` / `20261005055754_persist_calendar_item` 두 건만
  ai-hub-dev에 동일 transaction으로 적용하고 해당 version/name/statements 이력을 등록했다. Production 미적용.
- 적용 전 모든 기존 local version은 remote에 존재했고, 기존 초기 2건 remote-only 상태를 유지했다.
  기존 Migration 파일 수정·재적용·history repair/delete/reset 없이 신규 두 건만 등록했다.
- 원격 함수 본문과 로컬 SQL의 정확한 일치, SECURITY DEFINER/빈 search_path/service_role-only 권한 PASS.
  upsert 외 기존 함수, table/column/index/RLS/constraint/trigger 및 기존 Migration 이력 hash 동일.
  기존 connections/private tokens/ITEM/Classification/Action/Evidence hash와 사용자 수 동일.
- 적용 후 **실제 ai-hub-dev PostgreSQL 합성 transaction/rollback RPC/RLS PASS**.
  create/reuse(행 전체 동일)/update/동일 identity/hash/stale source/ITEM CAS/거부 원자 보존,
  known cancellation의 마지막 정상 본문·날짜·URL/분석 보존, unknown cancellation skip,
  all-day exclusive end/recurring occurrence/null source dates/User Edited/Action/Evidence 보존을 검증했다.
  partial Scope/foreign owner·account/token CAS/전체 checkpoint·timestamp 보존,
  owner/foreign/anon 실제 DB RLS 및 disconnect 후 ITEM 보존 PASS. 합성 사용자와 데이터는 모두 rollback했다.
  다중 세션 동시 경합을 직접 실행했다는 의미는 아니다.
- Gmail 실제 refresh → 암호화 guarded RPC 저장 → 새 Access Token의 Gmail profile 조회 PASS.
  refresh token/Scope/전체 sync_state/history_id/initial_collection/last_synced_at 보존. 메일 재수집 없음.
- 기존 실제 Docs **1건 재수집 reused**, 동일 ITEM·identity 1·본문 재다운로드 없음,
  Library/Detail/original_url/타 사용자 조회 차단/실제 DB RLS PASS. 기존 Gmail/분석 데이터 보존.
  위 CLI 회귀는 auth/cookie adapter 대체이며 Browser login/collect HTTP/UI 재검증과 구분한다.
- Calendar 추가 동의 이전 연결/Scope/checkpoint 및 기존 Gmail/Drive/분석 hash를 비공개 임시 파일에 캡처했다.
  credential 기록 없음. 실제 Calendar Event 조회·저장은 아직 실행하지 않았다.
- Google Cloud Console의 `ai-hub-dev-510512` Calendar API 제품 화면에 **‘사용’** 표시를 확인했다.
  사용자에게 AI Hub Dev 프로젝트 확인 후 API 활성화를 요청했으며 직접 활성화하지 않았다.
  활성화 완료 확인 뒤 동일 계정 incremental OAuth 동의가 필요하다. consent는 사용자 직접 수행한다.
- test 103개/typecheck/lint/build/check:supabase/diff 검사 PASS. 새 live 검증 스크립트도 최종 lint를 확인한다.
  check:supabase는 Auth settings 연결만 확인하며 DB/RLS 결과는 위 별도 Runtime 검증에 근거한다.
- 코드 변경은 검증 스크립트와 기존 Drive live loader의 Calendar Detail 의존성 추가 및 문서뿐이다.
  제품 UI/UX·수집 계약 변경 없음. DB Schema 변경 없음(승인 함수 변경/신규 함수 및 history 2건).

사용자가 API 활성화 완료를 알린 뒤 같은 프로젝트의 Calendar API 화면에서 **‘사용 설정됨’** 상태를 확인했다.
API 활성화 blocker는 해소됐다. 기존 authorize API를 호출하는 임시 `public/calendar3-consent-test.html`을 열어
사용자에게 기존 테스트 계정으로 `calendar_scope_upgrade` 직접 동의를 요청했다. 일정 수집 기능은 없다.
이 파일은 검증용이며 동의 완료 후 삭제한다. 제품 UI/UX로 편입하지 않는다. 민감정보 없는 안내 화면만 `.temp`에 보관한다.

**RESULT: PARTIAL. Calendar-3/전체 Calendar 미완료. blocker = 사용자 실제 OAuth 동의 대기.**
최초 동의 시작은 로컬 개발 서버 sandbox의 Supabase Auth 네트워크 차단으로 authorize HTTP 500이었다.
사용자가 표시된 준비 실패를 알렸고, 저장된 Calendar Scope=false/기존 계정·Scope·checkpoint 보존을 boolean으로 확인했다.
동일 서버를 네트워크 허용으로 재시작한 뒤 authorize에서 Google 동의 화면 도달을 확인했다.
코드/권한을 우회하지 않았으며 사용자에게 실제 추가 동의를 다시 요청했다. 아직 동의·Event PASS로 처리하지 않는다.
이후 Google 동의 완료로 Settings에 돌아온 실제 저장 상태를 검사하여 Calendar/Gmail/Drive/Docs Scope,
동일 계정/connection/소유자/전체 checkpoint/last_synced_at 및 기존 Gmail·Drive·분석 hash 보존 PASS.
암호화 refresh bundle 확인 및 실제 Calendar API list 요청 PASS. 임시 동의 HTML은 삭제했다.
Settings에는 Calendar 버튼/완료 문구가 구현되지 않아 기존 메일 화면을 표시한다. 제품 UI 변경은 이번 범위에 포함하지 않았다.
실제 primary 고정 기간 첫 페이지에서 적격 일반 Event를 찾지 못해 ITEM 저장은 **0건**이다.
실제 Event E2E/재수집/Calendar Library·Detail·실제 ITEM RLS는 아직 미검증이다. 사용자에게 기본 캘린더의 일반 테스트 일정 1건 생성을 요청했다.
Google 원본에 쓰기를 하지 않았다. 실제 Event 목록/제목/본문/PII 출력 없음.
**최신 RESULT: PARTIAL. OAuth blocker 해소. 현재 blocker = 실제 E2E용 테스트 일정 1건 대기.**
후속: API 활성화 확인 → 실제 동의/Scope/refresh/동일 계정·checkpoint 확인 → 실제 primary Event 최초 1건
E2E/저장/재수집/Library·Detail/RLS/보존 → 최종 회귀와 문서 판정. Google 원본 수정 없이 special cases는 합성 결과와 구분한다.
남은 TODO: Browser cookie HTTP/UI 회귀, 배포 실행 제한, syncToken/기간 밖 이동, primary alias 후속 정규화,
Calendar AI 분석 전 Cross-ITEM Action 병합 기준. 다음 개발 단계는 PDF/이미지 직접 업로드이며 현재 시작하지 않는다.

## 10. Calendar-3 최종 PASS / 전체 Calendar COMPLETE (2026-10-05)

- Calendar-1 기준/Calendar-2 구현/Calendar-3 실제 검증 **COMPLETE**, 전체 Calendar **COMPLETE**. Calendar-4 없음.
- 승인된 Migration `20261005055748` / `20261005055754` 두 건만 ai-hub-dev 적용·history 등록 PASS.
  함수/권한 및 이력 version/name/statements 로컬·원격 정확히 일치. Production 미적용.
  기존 초기 2건 remote-only 이력 유지. 기존 Migration 파일 수정·repair/reset 없음.
  DB table/column/index/RLS/constraint/trigger 변경 없음. 기존 함수는 승인된 upsert Scope 경계만 변경했다.
- 실제 PostgreSQL 합성 RPC/RLS transaction/rollback PASS. create/reuse/update/CAS/stale/hash/owner/
  active connection/Scope/Token/partial grants/account/token CAS/실패 원자 보존/checkpoint/disconnect 검증.
  User Edited/Classification/Action/Evidence/aiAnalysis 및 마지막 정상 콘텐츠 보존, unknown cancelled skip PASS.
  all-day 배타적 end/반복 occurrence/null source dates/known cancelled는 합성 데이터로 검증했으며 실제 원본 변경 없음.
- Google Cloud AI Hub Dev Calendar API 활성 상태 확인 PASS. 사용자 직접 incremental consent 완료 후
  실제 저장 Calendar/Gmail/Drive/Docs Scope·암호화 refresh bundle·동일 계정/connection/소유자와
  전체 sync_state/history_id/initial_collection/last_synced_at 및 기존 ITEM/분석 hash 보존 PASS.
  콜백은 실제 브라우저 세션을 사용했다. 임시 동의 HTML은 삭제했으며 제품 UI로 편입하지 않았다.
- 사용자 생성 **일반 시간 지정 primary Event 1건** 실제 list → validation/정규화/canonical text/hash →
  production collector → persist_calendar_item **신규 ITEM 1건 생성 PASS**.
  source=calendar/format=calendar_event/container=primary, source created/updated, title/original_url,
  본문/hash/20-key metadata/start/end/offset/timezone/null mime·storage/queued 값 정확한 mapping PASS.
  이후 동일 Event를 실제 GET으로 재조회 후 재수집하여 **동일 ITEM reused**, DB 행 전체 동일·identity count=1 PASS.
  제목/본문/PII/provider response/인증값 출력 없음. Google 원본 수정·Gemini 호출 없음.
- Classification/Action/Deadline/AI eventObservations 생성 없음. 실제 Detail의 해당 값도 비어 있음 PASS.
  일정 날짜는 event date이며 Action deadline으로 만들지 않았다. queued는 AI/검색 완료를 의미하지 않는다.
- Library/Detail 서버 조회·original_url·Calendar whitelist PASS. 실제 ITEM의 owner authenticated 허용,
  foreign authenticated/anon 차단 및 타 사용자 서버 조회 차단 PASS(실제 DB role/claim transaction·rollback).
  CLI 수집의 auth/cookie 및 단일 Event selection adapter는 대체했다. 브라우저 collect HTTP E2E는 재실행하지 않았다.
  별도로 **실제 로그인 cookie로 Calendar Library 1건 → Detail → Google 원본 링크/Action 없음 표시 PASS**.
  이 브라우저 조회는 서비스의 일반 session/RLS 서버 경로를 사용한다. service_role을 일반 조회로 바꾸지 않았다.
- Calendar 동의·저장 이후 최종 Gmail refresh → guarded RPC → Gmail profile PASS.
  Calendar 포함 저장 Scope/refresh token/전체 checkpoint 유지. 기존 메일 재수집 없음.
- 최종 기존 Docs 1건 재수집 reused/동일 identity/본문 재다운로드 없음 PASS.
  Gmail/Drive ITEM·기존 Classification/Action/Evidence/분석, 연결 및 Scope/checkpoint 보존 PASS.
- 최종 npm test **103개**, typecheck/lint/build/check:supabase/git diff --check PASS.
  check:supabase는 Auth settings 읽기 연결 검사이며 실제 RLS는 위 별도 DB 검증에 근거한다.
- 완료 blocker **없음**. 남은 범위는 MVP 제한/TODO이며 이번 완료 조건을 차단하지 않는다:
  Settings Calendar 버튼/완료 안내, Browser collect HTTP E2E·logout/re-login 전체 재검증,
  다중 세션 동시 경합, 배포 실행 제한, syncToken/기간 밖 이동, primary alias 정규화,
  Calendar AI 분석 전 Cross-ITEM Action 병합 기준. 실제 all-day/recurring/cancelled 추가 검증은 후속이다.
- Notion 원본 미수정. 다음 단계 = **PDF/이미지 직접 업로드**. 해당 단계는 시작하지 않고 정지한다.


## 11. Upload-2 PASS / 구현 COMPLETE (2026-10-05)

- Upload-1 권장안 승인 및 Upload-2 확정 조건을 사용자 첨부에서 확인했다. Upload는 1/2/3만 사용한다.
  Upload-1 COMPLETE / Upload-2 **COMPLETE** / Upload-3 **미시작·별도 승인 대기**. 전체 Upload 완료는 아니다.
- 변경 파일: `src/types/uploads.ts`, `src/lib/uploads/{contract,service,providers,http,cleanup}.ts`,
  `src/app/api/v1/uploads/route.ts`, `uploads/[uploadId]/complete/route.ts`, `items/[itemId]/original/route.ts`,
  `src/lib/items/queries.ts`, `src/types/{items,database}.ts`, `src/lib/supabase/admin.ts`,
  `workers/upload/{parser,child,isolate,server}.mjs`, `Dockerfile`, `README.md`,
  `scripts/{upload-fixtures,test-upload,test-upload-sql}.mjs`, `test-items.mjs` 및 기존 Drive/Calendar live loader 의존성,
  `package.json/package-lock.json/.env.example`, `SPEC.md/API_SPEC.md/scripts/README.md/supabase/README.md`,
  신규 로컬 SQL와 동일 검토본 `docs/drafts/upload/20261005070410_upload_storage_session_boundary.sql`.
  기존 Calendar/Drive 변경과 실제 완료 판정은 보존했다. 기존 Migration 수정 및 AI schema/UI 변경 없음.
- 세 API 구현: POST upload session / POST complete / GET 본인 original signed URL.
  로그인·same origin·정확한 요청 필드·UUID Idempotency-Key·bounded body·safe error·private no-store.
  complete는 기존 nested ITEM 응답과 outcome/state, Detail GET에는 안전한 upload 상태/page map만 추가한다.
- Storage 계약: private upload-originals, 5MB 및 PDF/PNG/JPEG MIME 제한,
  `{userId}/{uploadUuid}/original.{pdf|png|jpg}` 서버 path, overwrite/public URL 없음.
  filename은 정규화 표시값에만 사용하며 본인 검증 ITEM의 cookie RLS 조회 후 60초 signed original.
  signed upload token=2h, logical session complete=15m을 구분한다.
- extension+declared MIME+signature+full parser/decoder를 확인한다.
  5,000,000B/10pages/20MP/side10,000px/1concurrent/100,000CP/400,000UTF8B/전체120s/OCR20s.
  생성한 합성 PDF/PNG/JPEG bytes를 실제 parser child에서 검사했으며 사용자 파일/실제 Storage upload는 하지 않았다.
- PDF.js 6.4.299는 페이지별 embedded text 우선, scan page만 200DPI PNG로 렌더해 OCR한다.
  혼합 PDF의 별도 text/scan page fixture PASS. 암호화/손상/active/embedded file/외부 자원 금지.
  자동 복구를 허용하지 않기 위해 classic xref를 선검사한다. xref stream, 같은 page text+raster 및
  비단조 text order는 PDF_LAYOUT_NEEDS_REVIEW; incremental/hybrid references는 보수적으로 거부한다.
  일반 PDF layout 완전 복원이나 실제 Cloud Run 환경 검증을 완료했다는 뜻은 아니다.
- Cloud Vision DOCUMENT_TEXT_DETECTION adapter는 ADC/서버 전용이며 default disabled.
  mock response만 사용했고 confidence 낮은 문자도 유지한다. raw response/인증값은 저장/출력하지 않는다.
  파서는 credential-free child/192MB JS heap/kill timeout/stdout·stderr 무시/네트워크 URL 입력 없음.
  실제 배포의 IAM/concurrency1/maxinstances1/512MiB/native memory/egress 차단은 Upload-3 준비 조건이다.
- source upload/format pdf|image/connection·container·originalURL NULL/externalId serverUUID.
  사용자별 원본 bytes SHA256 unique/dedupe와 추출 text SHA256을 분리한다.
  같은 bytes·다른 filename 재사용, 같은 filename·다른 bytes 신규, 타 사용자 분리, key replay/conflict PASS.
- Storage/parser/OCR I/O 중 DB transaction 없음. 짧은 global reservation은 처리 전체 동시1파일을 제한한다.
  pending ITEM 생성→extracting→전체 text/ranges/hash 원자 완료→queued. extraction 상태는 별도 metadata.
  실패 시 부분 text 없이 failed, Storage 성공/DB 실패 및 응답 유실은 동일 complete 재시도 가능.
  attempt/lease/ITEM updated_at CAS로 stale finish 차단. 기존 override/Classification/Action/Evidence 보호.
  DB claim 응답 유실 등 모호한 실패의 lease는 만료 후 재시도로 회복하며 타 attempt를 덮어쓰지 않는다.
- Evidence/page map은 1-based page, 최종 NFC content_text의 CP 0-based/end-exclusive, page 사이 두 newline.
  이미지 전체1page, provider/method/version/confidence whitelist. OCR bounding box/UI 없음.
- orphan 정리는 server-only entry, 기본 dry-run, token 만료보다 긴 2h15 window, ITEM 무참조/inactive lease/
  exact session path·cleanup attempt CAS 조건만 허용한다. 실제 정리 job 호출/Storage 삭제 없음.
- 신규 Migration `20261005070410_upload_storage_session_boundary.sql`은 private session RLS/service RPC,
  upload UUID/raw hash unique index, bucket/policies, exact path owner, reservation/lease/CAS/원자 저장·정리만 정의한다.
  authenticated는 본인 eligible object INSERT/SELECT만, UPDATE/upsert/DELETE 없음.
  기존 enum에는 uploaded/queued/extracting 모두 존재하여 새 enum 변경 없음(로컬 실제 schema와 SQL 실행 기준).
- **원격 DB·Migration history·Storage bucket/policy 변경 0. 실제 파일 업로드/Vision 호출 0.**
  API 활성화/credential 설정·worker 배포/Production 변경 없음. Gemini/분류/Action/Deadline/Embedding 생성 없음.
- 최종 `npm test` **115개 PASS**, SQL isolated PostgreSQL **11 checks PASS**,
  SQL AST 21 statements/PLpgSQL pglast parser PASS(catalog rowtype→record 치환; 원본 SQL의 실행은 별도 PostgreSQL 검증),
  typecheck/lint/build/check:supabase/git diff --check PASS. Supabase 검사는 Auth settings 읽기만 수행했다.
  Storage RLS는 ephemeral mock catalog의 실제 DB role/RLS이며 실제 Supabase Storage API 또는 원격 RLS 검증이 아니다.
  SQL 직렬화/lease 경로는 검증했으나 실제 다중 서버 경합을 실행하지 않았다. Upload-3에서 별도로 확인한다.
- `npm audit --omit=dev` 0건. 전체 audit의 high 8건은 기존 HEAD에도 있는 braces 3.0.3를 경유한
  ESLint/shadcn/ts-morph 개발 의존성이다. 요청 범위 밖 major downgrade/force audit fix를 수행하지 않았다.
- Upload-2 blocker 없음. Upload-3 진행 조건은 사용자의 신규 SQL 및 private bucket/policy dev 적용 승인,
  실제 환경 worker/IAM/egress/ADC/Vision 설정과 테스트 파일 지정·실제 E2E 승인이다.
  지금은 실제 적용 승인만 요청하고 멈춘다. Notion 원본 미수정.


## 12. Upload-3 진행 / RESULT PARTIAL — 서버 인증·worker 대기 (2026-10-05)

사용자 첨부의 Upload-3 요청으로 검토 SQL 한 건의 dev 적용, 실제 Storage/RPC, 개인정보 없는
synthetic text PDF/이미지 E2E 및 Gmail/Drive/Calendar 회귀가 승인됐다. Upload-4는 만들지 않는다.
Cloud API 비활성/credential 미설정 시 임의 credential 생성 없이 필요한 설정 안내 후 기다리는 조건을 따른다.

- 최종 정적 및 SQL 격리 검증 11개 PASS 후 **20261005070410_upload_storage_session_boundary**
  한 건만 ai-hub-dev에 적용·history 등록 PASS. draft 파일 보존, Migration/draft bytes 동일.
  기존 local Migration 수정 및 db push/repair/reset/초기 remote-only 이력 변경 없음.
  기존 데이터/Token/Classification/Action/Evidence와 기존 table/column/index/RLS/constraint/trigger/함수/
  history/bucket hash를 적용 전후 key별 비교해 보존 확인했다. Upload 신규 session/index/RPC/bucket/policy만 추가.
  Production 변경 없음. `scripts/apply-upload-dev.mjs`, `verify-upload-dev.mjs`에 재현 가능한 검사.
- 실제 private upload-originals/5MB/PDF-PNG-JPEG 허용 및 INSERT/SELECT owner predicate/service-only RPC 확인 PASS.
  actual Storage HTTP: authenticated INSERT, signed upload 및 동일 token overwrite 거절, owner 원본 GET/
  60초 signed download, private public URL 거절, foreign/anon/임의 path/타 user prefix 거절,
  authenticated overwrite/delete 차단 및 bytes hash 불변 PASS. service_role로 일반 사용자 조회를 대신하지 않았다.
- 실제 DB 합성 transaction: session/pending/complete/failed/retry/dedupe/key replay/conflict/stale attempt/
  expired lease/owner/path/분석 및 User Edited graph 보존 PASS. 실제 authenticated owner 허용/foreign 차단.
  anon은 기존 SELECT privilege에서 차단되며 이를 정상 거절로 검증했다. 권한을 넓히지 않았다.
  합성 사용자/session/ITEM/분석 sentinel은 전체 rollback, 기존 데이터 및 사용자 수 불변 확인.
- Storage Runtime은 실제 Auth API로 synthetic owner/foreign principal을 생성·로그인했다.
  생성 PNG 2개 및 pending ITEM으로 Storage RLS와 소유자 다운로드를 검증했고, exact UUID paths의 object를
  먼저 삭제한 뒤 해당 synthetic Auth users만 삭제해 완전히 정리했다. 기존 사용자 데이터 삭제 없음.
  Storage 검증 PNG는 원본 저장/validation/owner read용으로 OCR을 수행하지 않았다. 필수 image OCR E2E가 아니다.
- production Original GET handler/Library/Detail을 실제 JWT principal client로 호출하여
  owner 200/foreign 404/anonymous 401/private no-store/token lifetime 60s/path query 무시 및
  canonical path/Detail whitelist/raw hash·path 비노출/original URL NULL/AI·Action 없음 PASS.
  CLI session adapter와 직접 route handler를 사용했다. Browser cookie HTTP/UI E2E와 구분한다.
- Google Cloud Console에서 **AI Hub Dev / ai-hub-dev-510512 / Cloud Vision API 사용 설정됨** 확인 PASS.
  활성화를 변경하지 않았다. 실제 Vision request/credential 생성/credential 출력은 0회.
- 현재 로컬: UPLOAD_WORKER_URL 없음, GOOGLE_CLOUD_PROJECT 없음, UPLOAD_OCR_ENABLED=false,
  explicit GOOGLE_APPLICATION_CREDENTIALS 및 표준 Windows ADC 파일 없음. PATH에 gcloud/docker 발견 안 됨.
  실제 worker/IAM/invoker/concurrency/native memory/egress 및 서버 인증은 미검증이다.
  **필수 text PDF E2E, image OCR E2E, 실제 Vision OCR은 아직 미검증**이며 COMPLETE로 처리하지 않는다.
  scanned PDF는 앞 단계 실제 local parser fixture/mock OCR PASS만 유지, 실제 scanned PDF OCR 미검증.
- 개인정보 없는 small synthetic text PDF/문자 포함 PNG를 ignored `.temp/upload3-fixtures`에 생성했다.
  이 두 파일은 아직 실제 업로드하지 않았다. 생성 스크립트 `upload-e2e-fixtures.mjs`는 OCR 호출이 없다.
- 실제 Gmail refresh→encrypted guarded RPC→Gmail profile PASS. refresh token/Calendar 포함 Scope/
  전체 sync_state/history_id/initial_collection/last_synced_at 보존, 기존 메일 재수집 없음.
  access token refresh는 승인된 회귀 동작이며 새 암호화 access bundle이 저장됐다.
- 실제 기존 Doc 1건 재수집 reused, 같은 ITEM/identity/modifiedTime·본문 재다운로드 없음/
  Library/Detail/originalURL/타 사용자 owner-filter 및 실제 DB RLS PASS. Google 원본 수정 없음.
- 실제 기존 primary Calendar Event 1건 재조회/재수집 reused, DB 행 전체 불변/동일 identity,
  start/end/calendar 객체/Action·Deadline 없음/Library/Detail/실제 owner/foreign/anon DB RLS PASS.
  기존 Gmail/Drive/분석 hash·Google 연결 Scope/checkpoint 보존. CLI auth/selection adapter 사용, Browser collect E2E 아님.
- test **115 PASS**, typecheck/lint/build/check:supabase/diff PASS. check:supabase는 Auth 연결 읽기 검사.
  개발 의존성 audit high 8건 기록 유지. 실행 의존성 audit 0건 재확인. force fix 없음.
  Gemini/새 AI schema/자동 Classification/Action/Deadline/Embedding/Search indexing 생성 없음.
- 변경 파일은 위 검증 스크립트 7개, `docs/UPLOAD_RUNTIME_SETUP.md`, 상태 및 검증 문서뿐이다.
  기존 draft/Migration/제품 코드/UI/AI schema 변경 없음. Notion 미수정.
- **RESULT PARTIAL. Upload-1/2 COMPLETE. Upload-3/전체 Upload 미완료.**
  blocker = 로컬 서버 ADC 인증 및 IAM private parser worker 설정.
  최소 사용자 설정은 `docs/UPLOAD_RUNTIME_SETUP.md`의 ADC login/quota-project. 키를 채팅/Git에 전달하지 않는다.
  기존 서버 인증 방식이 있으면 값 대신 환경/방식만 알려준다. 인증 후 worker 연결·필수 실제 두 파일 E2E와
  최종 회귀를 이어간다. Search/Embedding은 다음 단계이지만 지금 시작하지 않는다.


## 13. ADC 확인 / private parser 배포 준비 — NEEDS USER ACTION (2026-10-05)

- 사용자 ADC login/print-access-token 완료 통보 후, 표준 Windows ADC 파일과 gcloud SDK 설치를 확인했다.
  CLI 계정 일치, AI Hub Dev `ai-hub-dev-510512` ACTIVE/project ID 일치, ADC client/access token 획득/
  quota project 일치 PASS. 토큰은 메모리에서만 취급하고 Secret/credential 내용 출력·공유·key 생성 없음.
- `verify-upload-dev.mjs` 및 실제 `test-upload-db.mjs` 재실행 PASS. approved Migration/historical statements/
  함수 본문 일치 및 초기 2개 remote-only 유지. 합성 RPC/RLS/분석 보존 transaction 전체 rollback.
- actual Storage API/owner·foreign·anon/canonical path/private/no-overwrite/signed lifetime 60s 및
  production Original handler/Library/Detail real principal 검증 재실행 PASS. synthetic 객체/사용자 정리 완료.
  일반 사용자 조회에는 service_role을 쓰지 않았다. 브라우저 HTTP E2E와 구분한다.
- 기존 parser entrypoint `node workers/upload/server.mjs` / PORT8080 / POST `/inspect`,
  fresh child → PDF.js/sharp 경로 확인. 실제 localhost HTTP synthetic PDF smoke PASS.
  기존 Dockerfile Node24.12.0/nonroot/production dependency 구조 유지. Linux image build는 아직 미검증.
- source deploy용 8-file allowlist ignored staging 생성: package/lock/Dockerfile 및 4개 worker mjs/.gcloudignore.
  repository 전체·.env·ADC·키·fixtures·사용자 문서·Google token 포함 없음. 파일/lock hash 비교로 stale context 방지.
- private Cloud Run 배포 스크립트 준비: project fixed, service ai-hub-upload-parser, Seoul asia-northeast3,
  --no-allow-unauthenticated, attached dedicated parser SA(no project roles), 별도 builder SA(run.builder),
  concurrency1/maxinstances1/mininstances0/CPU1/512MiB/120s, Direct VPC all-traffic/network tag egress deny v4/v6.
  JSON SA key 생성 명령 없음. 실제 private ID token 호출/IAM/native memory/egress 검증은 배포 이후 수행한다.
- **Cloud Billing 조회 결과 billingEnabled=false.** 기본 배포 preflight가 이 상태에서 정지했다.
  Cloud Run/Build/AR/Compute/IAM API 활성화·service account/IAM/VPC/firewall/worker 생성은 0건이다.
  결제 연결·카드 입력을 대신하지 않는다. 사용자에게 프로젝트 결제 연결 완료 여부를 요청했다.
- UPLOAD_WORKER_URL 없음. 실제 배포 status.url 확인 후 server .env.local에 project/URL을 넣고
  OCR flag=false 상태로 private 호출을 먼저 검증한다. placeholder·public URL·NEXT_PUBLIC credential 없음.
  설정 방법은 `docs/UPLOAD_RUNTIME_SETUP.md`에 기록했다. `.env.local` 및 기존 product 코드는 수정하지 않았다.
- 변경: prepare/deploy-upload-worker.ps1, check-upload-adc.mjs, test-upload-worker-entrypoint.mjs 및 문서.
  PowerShell 구문/allowlist/context 준비, local entrypoint, lint/diff PASS. 기존 Migration/draft/AI schema/UI 변경 없음.
- 현재 **RESULT NEEDS USER ACTION**: ADC blocker 해소, 다음 blocker = AI Hub Dev Cloud Billing 연결.
  worker 배포가 끝나기 전 실제 OCR E2E를 시작하지 않는 사용자 조건을 유지한다. 실제 Vision OCR 0회.
  Upload-3/전체 Upload 미완료. Search/Embedding 미시작. 결제 연결 후 기존 승인 배포·private 인증 확인을 이어간다.

## 14. Upload-3 browser OCR 구현 / READY_FOR_MIGRATION 이력 (2026-10-05)

사용자 신규 첨부의 최종 정책이 12~13절 Cloud/ADC/Billing 대기 조건을 대체한다.
Upload-1/2 COMPLETE는 유지, Upload-3/전체 Upload는 아직 미완료. Upload-4 없음.

- MVP = text PDF server PDF.js / PNG-JPEG browser Tesseract.js / scanned PDF browser PDF.js render+OCR.
  Cloud Vision/Cloud Run/Billing/OCR ADC/UPLOAD_WORKER_URL은 MVP 제외. 기존 ADC/Google OAuth 그대로.
  Gemini fallback은 향후 선택적 provider TODO, 자동 fallback/실제 Gemini/Search/Embedding 없음.
- Generic OCRProvider interface/result + injected factory, BrowserTesseractProvider 구현. Tesseract 7.0.0,
  kor+eng/best_int/cache/단일 OCR Worker/순차 page, lazy adapter 로딩, 완료·취소·오류·timeout terminate.
  pinned Worker protocol을 adapter 내부로 한정해 초기화 단계에서도 직접 Worker 종료 가능.
  PDF render용 별도 PDF.js Worker는 OCR 엔진 병렬 Worker가 아니다.
- same-origin Worker/WASM/kor-eng/PDF worker assets 준비. language fixed URLs/SHA256은
  workers/upload/browser-assets.json, 생성 binary/data는 ignored public/ocr. prebuild 자동 준비/hash 검증.
  asset HTTP CSP/cache PASS; /ocr static은 session refresh 대상 제외, 기존 보호 page/API Auth 경계 유지.
- prepare: owner→reserve→private original→size/magic/full decode/PDF safety/page plan/hash→pending/dedupe.
  OCR 필요 시 lease release→페이지 번호/method 및 owner signed original. raster/embedded 본문/raw hash 미반환.
  Text PDF는 prepare에서 server text만으로 원자 완료하며 browser OCR 호출/로딩 0회.
- complete: 새 reservation→원본 hash/plan 재검증→exact OCR page set/whitelist/text bounds/NFC 검증→
  새 claim attempt→서버 ranges/content hash/metadata 생성→finish CAS. 클라이언트 range/hash/path/owner/status 금지.
  조작/누락 입력은 claim 전 거절/lease 해제, 서버 extraction/저장 실패는 부분 text 없이 matching fail.
  기존 완료 bytes는 우선 reuse. 미완료 bytes 중복은 새 완료처럼 반환하지 않고 UPLOAD_IN_PROGRESS.
- browser 중단은 server immediate failed가 아니다. localStorage는 사용자별 session UUID/key만.
  owner reprepare 및 fresh signed URL로 재접속/재시도; 완료 제출 뒤 취소는 이미 진행된 commit을 취소하지 않음.
  Library에 기능용 file/progress/cancel/retry만 연결, 별도 화면/스타일/UI 디자인 없음.
- extraction root/page origin fields: method/provider/providerVersion/execution/language/extractionVersion.
  embedded/pdfjs/server와 ocr/tesseract.js/client allowlist, mixed root + page별 origin.
  raw engine/bbox 미저장; confidence threshold 삭제 없음. client version/confidence는 실행 증명 아님.
  검색/AI/Evidence에 OCR 의미 불일치 위험이 남으며 원문 highlight는 후속 TODO.
- 후속 **20261005093526_upload_provider_neutral_rpc.sql** 작성, 원격 미적용.
  upload_session_rpc 한 함수의 provider/NFC/origin 검증·미완료 dedupe·expired running snapshot/CAS 복구만.
  새 table/column/index/bucket/RLS/Storage policy 없음. service-only/empty search_path 경계 유지.
  기존 적용 Migration/검토 draft 모두 SHA256 동일. 원격 SELECT로 기존 RPC 본문 동일/신규 이력 없음 확인.
- 테스트 123 PASS, ephemeral PostgreSQL SQL 13 checks PASS, pglast SQL+PLpgSQL 구문 PASS.
  parser actual synthetic fixtures/mocked browser OCR 및 cancellation/forgery/lease/fail/retry/User Edited graph 포함.
  typecheck/lint/build PASS, check:supabase Auth read PASS, diff check PASS. runtime audit 0, 기존 dev high8 기록 유지.
- local production check-upload-build.mjs: child/parser/sharp/pdfjs file tracing/표준 250MiB 이내,
  Worker/WASM/kor-eng/PDF worker HTTP CSP/cache, anonymous prepare/complete 401 PASS.
  이 결과는 actual Vercel/Linux native memory/OS isolation 또는 실제 browser OCR E2E가 아니다.
- synthetic text PDF/한영 PNG·JPEG/scanned·mixed PDF fixtures 준비. actual browser OCR→remote ITEM E2E 미실행.
  실제 Vercel 연결/배포 정보 없음. Vercel/native Linux 및 모바일 Android/iOS/실브라우저 WASM/IndexedDB 성능 미검증.
  5MB/10페이지 상한은 모바일 완료시간/메모리 보장이 아님; 파일/text truncate 없음.
- Remote DB/Storage apply/write 없음, 기존 Google 원본/Token 변경 없음, Notion 원본 미수정.
  Google 회귀는 이번 offline suite PASS이며 실제 provider 재수집은 12~13절 기록과 구분한다.
- **RESULT READY_FOR_MIGRATION**: 다음 필요 작업은 사용자 승인 후 신규 RPC dev 적용 및 실제 E2E/최종 회귀.
  승인 전 정지. 실제 Vercel verification은 별도 연결/배포 환경 필요. Upload-3/전체 Upload 미완료,
  Search/Embedding 다음 단계는 현재 시작하지 않는다.

## 15. Upload-3 최소 실제 E2E / 전체 Upload COMPLETE (2026-10-05)

사용자가 `20261005093526_upload_provider_neutral_rpc.sql` 한 건의 ai-hub-dev 적용과
최소 실제 E2E를 승인했다. 이 절이 14절 및 이전 Cloud/ADC/Billing 대기 상태를 대체한다.
실제 Vercel/Linux 배포 및 모바일 성능은 사용자 지정 후속 TODO이며 이번 MVP 완료 조건에서 제외한다.

- **Migration PASS**: 승인된 SHA256 그대로 단일 provider-neutral upload_session_rpc 적용/history 등록.
  table/column/index/RLS/bucket/policy 변경 없음. SECURITY DEFINER/empty search_path/service_role-only 유지.
  적용 직전/직후 기존 데이터, upload session, Storage 객체/bucket, schema/index/policy/다른 함수 및
  기존 history의 해시 동일. 모든 local version이 remote에 존재하고 초기 remote-only 2건은 보존.
  기존 적용 Migration/draft 및 신규 적용 SQL 파일은 수정하지 않았다.
- **Text PDF 실제 E2E PASS**: 로그인된 localhost Library에서 합성 PDF 1건을 signed upload.
  서버 PDF.js embedded text 추출, prepare에서 완료하여 browser OCR 분기/Worker 호출 0회.
  ITEM 저장/content SHA256/page range/embedded-pdfjs-server metadata 및 Library/Detail 본문 확인.
- **이미지 실제 OCR E2E PASS**: 동일 브라우저에서 한영 PNG 1건을 실제 Tesseract.js 7.0.0
  Worker/WASM/kor+eng으로 처리. 한글·영문·숫자 결과가 실제 ITEM과 Detail에 저장/표시됨.
  metadata.upload.extraction 및 page origin provider=tesseract.js, execution=client, language=kor+eng 확인.
  이를 일반적인 모든 이미지의 인식 정확도 보장으로 해석하지 않는다.
- **Dedupe PASS**: 동일 PNG를 새 Idempotency-Key로 재업로드, reused session이 기존 ITEM을 반환.
  같은 owner/raw SHA256의 ITEM은 정확히 1개. 기존 완료 원본/본문/metadata 유지.
- **RLS/Storage PASS**: 실제 합성 인증 소유자/타 사용자 및 익명 HTTP 클라이언트로 검사.
  exact session path INSERT/signed upload/owner download/60초 signed original 허용.
  foreign/anon/잘못된 prefix/path/public download 및 overwrite/delete 차단.
  실제 DB RLS의 타 사용자/익명 ITEM 조회 차단. production Original handler owner200/foreign404/anon401,
  private/no-store/canonical path 확인. 임시 테스트 사용자와 정확히 생성한 테스트 객체는 정리 완료.
  원본 handler 검증은 직접 호출+실제 인증 client adapter이며 browser download UI E2E라고 주장하지 않는다.
- **Library/Detail PASS**: 실제 사용자 브라우저에서 두 합성 ITEM의 Library 링크 및 Detail 콘텐츠 확인.
  추출 완료 상태는 metadata.extraction.status=complete이며 processing_status=queued는 후속 AI/검색 대기다.
  새 Action/분류/Embedding을 생성하지 않았다. 실제 사용자 소유의 합성 두 ITEM은 확인용으로 유지한다.
- **Gmail/Drive/Calendar 회귀 PASS**: 기존 ITEM/연결/token/Classification/Action/Evidence/user count 해시 유지.
  production Library/Detail 서버 조회 코드에서 각 source 1건의 저장 metadata/original 조회도 PASS.
  해당 조회는 기존 owner를 지정한 service-client adapter이며 Google API 재수집/refresh 또는 browser
  Google 전체 HTTP E2E를 재실행한 결과로 확대하지 않는다. Google 원본 수정 및 AI 호출 없음.
- **최종 검증**: 테스트 123 PASS, typecheck/lint/check:supabase/git diff --check PASS.
  직전 동일 제품 코드의 build 및 ephemeral SQL 13 checks PASS 결과 유지. 이번 변경은 검증 script/문서뿐이며
  기존 Upload/Google 제품 코드, dependency, Migration/Storage policy는 추가 수정하지 않았다.
- 남은 TODO: 실제 Vercel/Linux native parser 배포·시간/메모리, Android/iOS 모바일 성능,
  scanned/mixed PDF의 실제 브라우저 OCR 확대 검증. OCR client input과 원본 의미의 불일치 위험은 기존 정책 유지.
- **RESULT PASS. Upload-3 COMPLETE / 전체 Upload COMPLETE / blocker 없음.**
  Cloud Vision/Gemini OCR/Cloud Run 호출 0회. Search/Embedding 착수 가능하나 별도 지시 전 시작하지 않고 정지.
## 16. Search-1 최종 조건 / Search-2 COMPLETE (2026-10-05)

사용자가 승인한 추가 조건 9개를 `SPEC.md` 37절 및 `API_SPEC.md` 25절에 반영했다.
이 절은 이전 단계의 “Search 미착수” 기록을 대체한다. 제품 화면 변경과 Search-3 실제 품질 검증은 포함하지 않는다.

- **Read-only preflight PASS**: ai-hub-dev의 pgvector 0.8.2, 실제 search_chunks schema,
  embedding 0건/기존 dimension 미설정, RLS/GRANT/기존 RPC를 먼저 확인했다. 예상과 일치한 뒤 구현했다.
- **Migration PASS**: `supabase/migrations/20261005113838_search_contract_and_rpcs.sql`
  한 건만 ai-hub-dev에 적용/history 등록했다. 최초 작성 시 로컬 초안이라는 주석은 작성 시점 기록이다.
  적용 후 함수 본문/권한/history와 로컬 SQL 일치 확인. 적용된 SQL은 수정하지 않는다.
  기존 ITEM/Classification/Action/Evidence/Connection/Token 데이터 해시 동일.
  search_chunks 및 새 private job/cache/session은 모두 0건이며 실제 색인/backfill을 실행하지 않았다.
- **API**: POST /api/v1/search, POST /api/v1/items/[itemId]/index,
  GET /api/v1/items/[itemId]/similar. 사용자별 접근, 안전한 Source/Evidence 반환,
  기본 limit 20/최대 50, 5분 고정 결과 snapshot과 owner/context/version에 묶인 서명 cursor를 구현했다.
  페이지 사이 삭제·변경된 근거는 제외한다. 이 경우 빈 page에도 nextCursor가 있을 수 있다.
- **검색**: literal/FTS + 선택적 semantic RRF, ITEM 중복 제거. 중요도 점수는 ranking에 넣지 않았다.
  명확한 한국어 Action/Deadline intent는 고정 규칙과 기존 actions/deadline SQL로 처리한다.
  추가 LLM parser, 새 Action/Deadline 생성, User Edited 변경은 없다.
- **Embedding**: 서버 active Gemini / gemini-embedding-2 / 768 /
  gemini-embedding-2:768:retrieval-v1:chunk-v1 고정, provider interface 유지.
  다른 version 벡터를 비교하지 않는다. 변경 시 새 version 색인 → 검증 → active 전환을 따른다.
  각 chunk별 독립 embedContent 호출, runner cycle당 최대 8개 처리.
  원문 범위/PDF page/Drive tab 보존, lease/CAS/부분 색인 비노출/재개/최대 3회 실패 경계를 구현했다.
- **개인정보**: semantic 기본 false. 서버의 비민감 ITEM allowlist와 활성 설정이 모두 있어야
  문서 embedding을 허용한다. 실제 개인 Gmail/Drive/Calendar/Upload 전체 backfill은 별도 승인 필요.
  검색 query도 semantic query embedding 시 Gemini로 전송됨을 API/SPEC에 명시했다.
  키/본문/원본 ID/벡터는 로그·응답에 노출하지 않는다. ignored .env.local에 cursor secret을 설정했다.
- **비용/남용**: 공유 DB의 사용자별 atomic quota(검색 30/분, query embedding 10/분, 색인 5/분),
  사용자/query/version별 5분 cache와 중복 요청 lease. Retry-After 및 debounce 350ms 계약 제공.
  클라이언트 debounce를 보안 경계로 사용하지 않는다.
- **검증 PASS**: npm test 129개, Search SQL ephemeral pgvector 8 checks,
  typecheck/lint/build 및 git diff --check. 실제 Gemini 요청/실제 개인 데이터 backfill/Google API 호출 0회.
  이 결과는 원격 HTTP E2E 또는 실제 semantic 품질 합격을 뜻하지 않는다.
- **Advisor**: 새 Search RPC의 client EXECUTE 노출 없음. private 서버 전용 테이블의
  RLS enabled/no policy INFO는 의도된 client 차단이다. 기존 authenticated SECURITY DEFINER 함수와
  leaked-password-protection 경고는 기존 범위 그대로이며 Search 작업에서 변경하지 않았다.
- **Search-3 TODO**: `docs/SEARCH_GOLDEN.md`의 합성 golden query set으로 실제 query/index/Search HTTP,
  Top-3/Top-5, Source/Evidence, 모든 입력 형식, 날짜/권한/페이지/캐시 품질 gate 검증.
  actual semantic golden set은 아직 미실행이다. synthetic 데이터만 별도 실행하며 개인 전체 backfill과 구분한다.
- **최종 MVP 통합 TODO**: 중요문서 선정/사용자 수정/표시 계약 확정. Search relevance와 분리하며
  importance 점수를 검색 ranking에 혼합하지 않는다. 기존 Upload 배포·모바일 TODO도 유지한다.

**RESULT PASS — Search-2 COMPLETE. Search-3 품질/E2E 미실행; 개인 전체 backfill은 미승인.**

## 17. Search-3 COMPLETE / 전체 Search COMPLETE (2026-10-05)

사용자가 Search-3 PARTIAL의 핵심 검색 검증을 PASS로 인정하고 비민감 보존 검증 및 문서 마감을 지시했다.
Search-1 COMPLETE / Search-2 COMPLETE / Search-3 COMPLETE. 이 절이 이전의 Search-3 미실행 기록을 대체한다.

- **실제 semantic E2E PASS**: gemini / gemini-embedding-2 / dimension 768 /
  gemini-embedding-2:768:retrieval-v1:chunk-v1. synthetic/non-sensitive document·query만 전송했다.
  독립 chunk 호출, query/document 구분, finite/nonzero 768 vector 및 locator/reuse PASS.
  개인 Gmail/Drive/Calendar/Upload semantic backfill은 미실행이며 계속 별도 승인 전 금지다.
- **Corpus/Hybrid Search PASS**: 실제 dev schema에 A 20 ITEM/B 1 ITEM을 생성했다.
  Google source는 외부 수집 없이 schema-valid fixture로 생성했고 PDF page map도 검색용 fixture다.
  Image는 Upload-3의 실제 Tesseract 합성 OCR 텍스트/metadata를 재사용했다. 새 OCR/Google 수집 E2E가 아니다.
  A의 five-source 대표 6 ITEM(7 chunk)을 semantic 색인해 최초 coverage=6/20이었다.
  나머지 distractor는 keyword corpus로 유지했다. 각 후보 100, ITEM 병합, RRF k=60 동일 가중치,
  exact title 우선 및 source date/ID tie-break. score는 확률이 아니다. importance/Action/D-Day 혼합 없음.
- **Golden PASS**: exact title Rank 1, exact phrase Rank 1, semantic synonym Rank 2(Top-3 기준).
  한국어 partial, Gmail/Drive/Calendar/PDF/Image OCR, source/format/date filter는 각각 Rank 1.
  no-result, wildcard/injection, Similar, ACT, pagination, degraded 시나리오도 PASS.
  실제 rank query와 나머지 행동/보안 시나리오는 `docs/SEARCH_GOLDEN.md`에 기록했다.
- **Evidence/ACT/페이지 PASS**: 원문 substring/page/tab/range, Calendar start/end/allDay/timezone,
  안전한 Source, SQL Action/Deadline intent(해야 할 일/마감/이번 주 제출/내일까지/내일까지 제출),
  needs_review 기간 제외 및 행사일/Deadline 분리. 추가 LLM parser/Action 생성 없음.
  owner/context/version cursor, limit 20/50, snapshot 순회 중복·누락 0, 변조/필터 변경/타 사용자 차단.
  Similar는 동일 owner/version의 최대 4 source chunk, self 제외, 기본 5/최대 10, 미색인 not_indexed,
  추가 provider 호출 없음.
- **운영 PASS**: unchanged/metadata/locator/User Edited 벡터 reuse, 제목 재Embedding,
  PDF 변경 page만 재Embedding, stale commit 차단/cascade, 다른 version 제외.
  전용 synthetic 사용자별 5 ITEM backfill, concurrency 1, 실패/resume/progress, cycle 최대 8 chunk PASS.
  429/503/timeout/잘못된 vector는 격리 mock으로 확인했고 keyword_only/degraded 유지 PASS.
  DB 사용자 quota/HTTP 429, 5분 cache, filter/timezone/version key, 사용자별 cache 격리 PASS.
- **보존 PASS**: 기존 Google connection/provider/connected/granted scopes/disconnected_at 유지.
  과거 비민감 checkpoint와 Gmail history/sync_state를 대조했다.
  Gmail 46/Drive 1/Calendar 1/PDF 1/Image 1 유지. 과거 selection의 안정적 ITEM/source identity·owner,
  Drive original locator/tabs/한 identity 한 ITEM, Calendar start/end/primary Event,
  Upload Storage 원본 존재·owner 경로/OCR extraction 확인.
  Classification 2/AI metadata 2/Action 1/Evidence 1 및 원문 연결 유지. Calendar deadline 오생성 0.
  인정된 Library/Detail/keyword 회귀 PASS 유지. Google 재수집/idempotency를 재실행하지 않았다.
- **DB/RLS PASS**: 원격 public column 목록은 저장소 DB 계약과 일치. 기존 7 public table RLS/8 owner policy 유지.
  ITEM/Connection/Classification/Evidence 간 소유권 위반·orphan 0. history 추가는 Search 3건뿐이다.
  Search-3 coverage/ranking 보완 두 Migration은 dev 적용 완료. 기존 Migration 수정/Production 적용 없음.
  Search RPC는 SECURITY INVOKER/service_role-only이며 anon/authenticated EXECUTE 차단.
  기존 ITEM 수정·삭제 없는 색인 경계를 유지했고 정리 후 search_chunks/jobs=0, 기존 corpus 50 ITEM 유지.
- **Credential 검증 방식**: 이번 마감에서 Access/Refresh Token, ciphertext 또는 Token 파생 hash/fingerprint/digest를
  조회·계산·출력·비교하지 않았다. credential 보존은 비민감 connection 상태/scopes/checkpoint 및 기존 기능 회귀로 확인했다.
  Token 조회가 필요한 실제 refresh는 미실행이다. 비밀값 동등성이나 새 refresh 성공을 주장하지 않는다.
- **정리**: 합성 사용자 4명과 해당 corpus/chunks/jobs/cache/session 정리 완료.
  기존 사용자의 Storage/Google 원본·연결·분석은 삭제하거나 변경하지 않았다.
- **검사**: npm test 132 PASS, typecheck/lint/build/check:supabase/git diff --check PASS.
  직전 SQL 10 checks/실제 E2E 30 checks PASS 유지. 불필요한 provider 재호출 없음.
- **MVP 통합 TODO**: importance ≠ search relevance. 사용자 직접 중요 표시/Action/Deadline/D-Day 및
  필요 시 AI 보조 신호의 별도 중요문서 계약은 향후 통합 단계에서 확정한다.
  기존 Upload 배포·모바일 TODO와 기존 advisor/audit warning은 유지한다.

**RESULT PASS — Search-3 COMPLETE / 전체 Search COMPLETE / blocker 없음.**
다음 단계 = **Final Integration / MVP Final Verification**. 진행 가능하지만 이번 작업에서는 시작하지 않고 멈춘다.

## 18. Polished UI 2.0 + Full-stack Integration (2026-10-05)

사용자의 신규 첨부 요청으로 Final Integration UI 작업을 시작했다.
이 절은 17절의 이번 작업 미착수/정지 조건을 대체한다. 기존 Phase·Search·Upload COMPLETE 판정은 유지한다.

- **구현**: Today/Search/Actions의 placeholder 교체. 한국어 Shell/sidebar/bottom navigation,
  indigo tokens·읽기 쉬운 typography, 원문 우선 Detail, Library 간소화, Upload 상태·재시도,
  Settings Gmail/Drive/Calendar 권한·수집 UI. Production mock/prototype data 없음.
- **API**: 기존 Auth/session ITEM query, Search/Similar, Action·분류 조회, Google 수집/OAuth/disconnect,
  Upload create/prepare/complete/original, Gmail 수동 analyze 연결. connections.capabilities 공개 boolean 추가.
  신규 DB schema/RPC/Migration/Storage policy/권한 변경 없음. 개인 semantic backfill/Notion 수정 없음.
- **Browser**: 네트워크 허용 후 실제 로그인 PASS. 개발용 badge가 Mobile Today를 가린 문제 수정.
  Today 검색 form → query 유지, 실제 keyword Search/Source/Evidence/Detail, 20→40 pagination·중복 0,
  Gmail·Drive·Calendar 실제 수집 및 Library/Detail, 저장 분류·Action·Evidence 확인.
- **Google 재수집**: Gmail 기존 50/실패 0, Drive 기존 1/실패 0, Calendar 기존 1/실패 0.
  최초 Gmail 수집의 신규 건수는 별도 기록하지 않았으므로 정확한 신규 수를 주장하지 않는다.
  기존 원본 삭제/사용자 수정값 변경 없음. 실제 provider 수집은 refresh를 포함할 수 있으며
  credential 값·ciphertext·파생 hash를 직접 출력하거나 비교하지 않았다.
- **Upload**: 합성 scan PDF 및 JPEG의 실제 browser Tesseract OCR→저장→Detail PASS.
  한글·영문·숫자 확인. 업로드 원본 접근 endpoint 링크 준비 PASS. 검증용 합성 두 ITEM 유지.
  Cloud Vision/Gemini OCR/개인 파일 신규 업로드 없음. PDF/Image 기존 처리 로직 재사용.
- **Responsive**: Desktop 1440/1280px, Mobile 390px의 Today/Library/Search/Actions/Detail/Settings 확인.
  대표 화면 document width overflow 없음. 모바일 원문/분석 및 하단 navigation 검증.
  Android/iOS 실기기 성능 또는 Vercel/Linux 배포 검증으로 확대 해석하지 않는다.
- **검사**: npm test 136 PASS, typecheck/lint PASS. check:supabase는 sandbox 네트워크 제한으로
  첫 실행 실패했으나 네트워크 허용 후 Auth read PASS. 최종 build/git diff --check PASS.
- **Backend GAP**: Classification PATCH, Action 완료/복원·완료 목록 API 없음.
  analyze는 Gmail/email 한정이며 Drive/Calendar/Upload의 자동 분석·Action 추출 연쇄는 미연결.
  서비스 데이터 삭제 API 없음. 기존 개인 corpus semantic 색인은 별도 승인 전 계속 금지.
- **RESULT NEEDS_BACKEND_FIX**: 기존 API를 사용하는 UI 통합은 구현했지만 전체 MVP 완료 아님.
  상세 22개 항목과 남은 P0/P1/P2는 docs/POLISHED_UI_2_REPORT.md.
