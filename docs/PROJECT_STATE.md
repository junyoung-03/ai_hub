# PROJECT_STATE — 새 Codex 채팅 인계

최종 갱신: 2026-10-04 (Asia/Seoul)
프로젝트: `C:\Users\MYCOM\ai_hub`
현재 상태: **Phase 1~6A COMPLETE, Phase 6B COMPLETE. 다음 단계 구현 미착수.**
현재 허용 범위: 완료 검증·인계 종료. 다음 단계는 사용자 지시로 목표와 범위를 확정한 뒤 시작한다.

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
