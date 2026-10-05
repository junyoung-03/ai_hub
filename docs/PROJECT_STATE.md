# PROJECT_STATE — 새 Codex 채팅 인계

최종 갱신: 2026-10-05 (Asia/Seoul)
프로젝트: `C:\Users\MYCOM\ai_hub`
현재 상태: **Phase 1~6A/6B COMPLETE. Drive-1 COMPLETE / Drive-2 COMPLETE / Drive-3 COMPLETE. 전체 Drive 단계 COMPLETE. Scope/ITEM RPC Runtime 및 지정된 실제 Docs 1건 E2E PASS.**
현재 허용 범위: 승인된 Drive 검증을 완료하고 정지한다. 추가 문서 수집·Google 원본 수정·Gemini 호출·Calendar 착수는 하지 않는다.

## 1. 기준과 작업 원칙

- 제품 기준: Notion 「AI 통합 정보 허브 — 서비스 기획 및 개발 기준서 v0.5」 → 루트 `SPEC.md` → `README.md`.
- API: `API_SPEC.md` 23절. AI 분석: 루트 `AI_OUTPUT_SPEC.md` / `AI_OUTPUT_SCHEMA.json` v0.2.
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
