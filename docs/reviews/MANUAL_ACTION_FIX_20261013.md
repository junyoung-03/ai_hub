# Manual Action 저장 차단 수정 — 2026-10-13

RESULT: CORE_USER_FLOW_REVIEW_REQUIRED

## 적용 범위

사용자의 “진행해” 승인으로 `20261013003636_manual_action_evidence_boundary.sql`을 실제 연결 DB `oclzdppdiljbojvqtkeu`에 적용했다. Local과 Production이 공유하는 DB다. 애플리케이션 코드 commit/push/deploy는 실행하지 않았다.

- actions.origin: 기존 자료 기반 Action은 source(default), 직접 입력만 manual.
- 기존 Action 데이터와 Evidence, RLS/grants를 유지한다. origin 변경은 trigger로 차단한다.
- manual Action만 Evidence 없이 사용자 날짜를 저장할 수 있다. source Action의 근거/날짜 일치/충돌 규칙은 기존과 동일하다.
- manual에 Source/Evidence를 연결하는 것도 거부한다.
- create API는 로그인된 소유자의 manual Action만 생성한다. edit/delete는 RLS 조회, 명시적 origin, user_id, updated_at 조건으로 동일 row만 변경한다.
- AI 자료 기반 Action의 수정/삭제 정책은 이번 승인 범위 밖이며 여전히 차단한다. 기존 완료/복원 경로는 유지한다.

## 실제 DB 검증

브라우저 E2E와 구분되는 실제 DB connector 실행이다. privileged SQL 검증만으로 API 인증/Home 화면을 PASS 처리하지 않는다.

TEST Action: `1508ff6d-9595-4e0e-9442-affb6662039c`

| 항목 | DB 실제 결과 |
|---|---|
| 생성 | PASS — manual, source/ITEM 없음, 10월 24일 14:00 KST |
| 제목 수정 | PASS — 동일 ID, E2E_TEST_ACTION_PERSIST_EDIT_20261013 |
| 날짜·시간 수정 | PASS — 동일 ID, 10월 25일 15:00 KST |
| 완료 | PASS — completed, completed_at 저장 |
| 미완료 | PASS — open, completed_at null |
| 삭제 | PASS — 이번에 생성한 TEST Action만 삭제 |
| 요청 간 persistence | PASS — 매 단계 commit 후 다음 별도 요청에서 이전 저장값 재조회 |
| 삭제 후 재조회 | PASS — remaining 0 |

별도의 rollback 트랜잭션에서도 전체 CRUD 및 immediate constraint 검증을 실행했다. 기존 사용자 자료/할 일에는 쓰기를 수행하지 않았다.

## 브라우저 검증 차단

기존 Local 탭이 연결 오류 페이지 상태였으며, cua.getTab 호출이 URL protocol 보안 정책으로 거부됐다. 우회/다른 브라우저/쿠키 추출을 시도하지 않았다. 사용자는 휴대폰이라 직접 탭을 열 수 없다고 답했다.

Local 서버: http://localhost:3001/actions

Planner 버튼을 통한 API 호출, Home Calendar/Today Todo 반영, browser refresh persistence, logout/login, 화면 캡처는 이번 수정 후 **NOT RUN**이다. 따라서 전체 사용자 흐름 검증 완료로 보고하지 않는다. 사용자가 직접 탭을 다시 열 수 있는 환경에서 이어서 검증해야 한다.

## 코드 및 보안 검증

- npm test: PASS 270/270
- npm run test:isolated:manual-action-sql: PASS 8/8 (로컬 PostgreSQL/WASM, 실제 migration 적용)
- npm run typecheck: PASS
- npm run lint: PASS
- npm run build: PASS
- git diff --check: PASS (줄바꿈 경고만)
- 새 SQL 검증: source 없는 AI Action 거부, manual CRUD, origin 변경 거부, 가짜 Evidence 거부, RLS 타 사용자 조회 차단, browser role 직접 쓰기 차단, Action 삭제가 ITEM 삭제로 이어지지 않음.
- Supabase security advisors: 변경 전/후 항목 동일, 이번 수정으로 새 경고 없음. 기존 private RLS policy 없음 5개(INFO), authenticated SECURITY DEFINER callable 4개(WARN), leaked password protection OFF(WARN). 이번 변경 범위 밖이므로 임의 변경하지 않음.
  - https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
  - https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
  - https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## 다음 단계

DB 저장 차단 수정: APPLIED / DB VERIFIED

Browser E2E: PENDING

AI Classification: NOT STARTED
Promotional: OFF
Commit: NO
Push: NO
Deploy: NO

AI_CLASSIFICATION_GO: NO — 브라우저 핵심 흐름과 기존 보고서의 미완료 항목을 해소해야 한다.
