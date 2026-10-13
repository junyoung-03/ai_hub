# 분류 개발 전 핵심 사용자 흐름 실제 검증 — 2026-10-13

RESULT: REVIEW_REQUIRED

다음 단계: CORE_FIX_REQUIRED. PDF AI Event 생성이 provider 장애로 완료되지 않았고, Gmail/Drive의 적절한 일정 테스트 자료가 없어 전체 준비 완료로 선언하지 않는다.

## 실행 환경과 범위

- 시작 branch: main. HEAD: 4c113f4. 직전: 3c283e4, 6799a31.
- 시작 시 tracked diff 없음. 기존 미추적 review 문서/스크린샷은 보존했다.
- PRODUCTION: https://ai-hub-one-ebon.vercel.app, deployment dpl_AVLhAvxECzBJJek1h4M9nqeYEg27, READY, HEAD 4c113f4 기준.
- LOCAL: http://localhost:3001, 위 HEAD + 오늘 할 일 로딩 분리 수정. 동일 연결 DB를 사용하지만 운영 코드와 로컬 코드를 구분했다.
- 검증 결과는 실제 브라우저 UI 실행과 소유자 조건을 둔 DB 읽기를 근거로 한다. 단위 테스트 결과를 E2E 성공으로 대체하지 않았다.
- Local 최초 서버 없음/제한된 프로세스의 인증 서버 fetch 실패를 확인했다. 인증 서버 연결이 가능한 개발 서버로 재시작한 후 실제 브라우저 검증을 수행했다. 오류 탭의 보안 제한을 우회하지 않았다.

## KNOWN ISSUES EXCLUDED

| 항목 | 상태 |
|---|---|
| Image AI partial failure | KNOWN ISSUE, 수정 안 함 |
| Manual Text AI partial failure | KNOWN ISSUE, 수정 안 함 |
| AI Extracted Action edit/delete | KNOWN ISSUE, 제한 유지 |
| Library AI classification | NOT STARTED |

## PLANNER MANUAL ACTION — PRODUCTION

| 항목 | 결과 | 실제 확인 |
|---|---|---|
| Create | PASS | UI E2E Planner Test, 10/14 14:00 생성. DB origin=manual, 1행 |
| Edit title | PASS | E2E Planner Test Updated, 동일 Action ID |
| Edit date | PASS | 10/14→10/15→오늘 10/13, 동일 행 |
| Edit time | PASS | 14:00→02:00, 실제 키보드 입력 후 DB KST 시간 확인 |
| Complete | PASS | completed_at 저장, refresh 후 미완료 복원 버튼 표시 |
| Reopen | PASS | refresh 후 완료 처리 버튼 표시 |
| Delete | PASS | TEST Action만 확인 dialog에서 삭제, refresh 후 미표시, DB 0행 |
| Refresh persistence | PASS | 추가/수정/완료/복원/삭제 각각 재조회 |
| Logout/login persistence | PASS | 로그아웃→Google로 동일 계정 재로그인→수정된 TEST Action 유지 |

TEST Action ID: fe6c85e5-65bd-4b32-948b-c0301bd1fc0c. 검증 후 UI에서 삭제했다. 기존 사용자 Action/Source/Evidence는 수정하거나 삭제하지 않았다. 자동화의 time input fill만으로는 React 값이 바뀌지 않아 실제 ArrowUp 입력으로 시간 변경 후 DB까지 확인했다.

## HOME

| 항목 | PRODUCTION | LOCAL |
|---|---|---|
| Manual Action calendar reflection | PASS | PASS |
| Today Todo reflection | PASS, Event 상세 조회 완료까지 지연 발생 | PASS, Action 조회 후 먼저 표시 |
| Updated date reflection | PASS, 10/14 TEST 제목 제거·10/15 표시 | NOT TESTABLE, 동일 시나리오 별도 재실행 안 함 |
| Deleted Action removal | PASS, Home refresh 후 제거 | PASS, Quick Todo 삭제 후 refresh에서도 제거 |
| Quick Todo actual create | NOT TESTABLE, 이번 단계에서는 Local에서 실행 | PASS |
| Calendar cell title only | PASS | PASS |
| Today title/time, no checkbox/status filters | PASS | PASS |
| Complete/reopen Home policy | NOT TESTABLE, 이번 단계는 Local에서 확인 | PASS, 완료 시 미완료 목록에서 제외 |

LOCAL Quick Todo: E2E Home Quick Todo Test, 10/13 14:00. ID 53dcd9d3-b740-452d-a392-756b2e2ad55d. DB origin=manual/open/2026-10-13T05:00Z 1행을 확인했다. 새로고침 후 Calendar/Today 제목+14:00 표시, Planner에서도 동일 제목·시간 표시. 완료→Home 제외→복원→TEST만 UI 삭제→Home refresh 후 미표시. 두 TEST Action 잔존 DB 행 수=0.

### 발견 및 최소 수정

Home TodayTodoList의 busy가 actions.busy || schedule.busy였다. schedule은 자료 100건의 상세를 3개씩 읽으므로 이미 Action이 로드돼도 오늘 할 일을 오랫동안 숨겼다. 운영에서는 최종 표시되었으므로 영구 저장 실패와 구분한다.

- TodayDashboard에서 Action busy와 Event scheduleBusy를 분리했다.
- TodayTodoList의 오늘 할 일은 Action busy만, 다가오는 일정은 scheduleBusy를 사용한다.
- 디자인/데이터/API/AI/schema 변경 없음. 전체 Event 상세 조회 지연 자체는 이 작은 수정으로 해결한 것으로 주장하지 않는다.
- Local 실제 Quick Todo refresh 직후, 다가오는 일정이 로딩 중인 동안 오늘 할 일과 14:00이 표시됨을 캡처했다.

## GOOGLE SYNC — PRODUCTION 실제 Settings 버튼

| 항목 | 결과 | 근거 |
|---|---|---|
| Gmail actual sync #1 | PASS | 수집 76, 신규 6, 재사용 70 |
| Gmail actual sync #2 | PASS | 수집 76, 신규 0, 재사용 76 |
| Gmail token | PASS | 실제 API 성공, refresh 시각 갱신 관찰; token 값 출력 안 함 |
| Gmail duplicate | PASS | external_id 86개 / 행 86개 |
| Gmail last sync | PASS | DB 2026-10-13T01:04:56.434Z, UI 재조회 반영 |
| Drive sync #1 | PASS | 신규0/갱신0/기존1/완료 |
| Drive sync #2 | PASS | 신규0/갱신0/기존1/완료 |
| Drive sync #3 | PASS | 신규0/갱신0/기존1/완료 |
| Drive token/API | PASS | 연결된 계정과 명시적 Google Doc ID 사용 |
| Drive 401 refresh retry branch | NOT TESTABLE | 실제 401 발생하지 않아 강제 성공 주장 안 함 |
| Drive duplicate | PASS | external_id 1개 / 행 1개 |
| Drive Library reflection | PASS | Drive 필터에서 실제 테스트 문서 표시 |
| Drive last sync | PASS | DB 2026-10-13T01:08:09.135Z |
| Calendar sync #1 | PASS | 신규0/갱신0/기존1/완료 |
| Calendar sync #2 | PASS | 신규0/갱신0/기존1/완료 |
| Calendar sync #3 | PASS | 신규0/갱신0/기존1/완료 |
| Calendar duplicate | PASS | external_id 1개 / 행 1개 |
| Calendar Home reflection | PASS | 10/5 테스트 버튼→Google 일정 상세→동일 ITEM 링크 |
| Calendar last sync | PASS | DB 2026-10-13T01:14:13.023Z |
| Calendar forced 401 / start=end | NOT TESTABLE | 해당 실제 입력/오류 없음 |

Drive는 이미 있는 AI Hub Drive 연동 테스트 Google Doc를 explicit ID로 수집했다. root fallback 없음. Google 원본 수정/삭제 없음. Calendar는 기존 테스트 일정(10/5 15:30–16:30 KST)을 사용했다. DB의 start/end/status와 실제 Home 상세 표시를 대조했다. 새 외부 일정은 생성하지 않았다. primary, 과거30/미래90 계약은 코드 확인과 실제 기존 일정 수집으로 구분하며 경계값 전체 실험을 PASS 처리하지 않는다.

Gmail/Drive 수집 후 기존 bounded AI 분석의 실패가 일부 함께 나타났다. 위 Sync PASS는 수집·저장·중복방지를 의미하며 전체 AI 분석 성공을 의미하지 않는다.

## AI EVENT → HOME

| 항목 | 결과 | 근거 |
|---|---|---|
| PDF actual upload/extraction/persistence | PASS | 실제 file chooser→업로드→본문 추출→DB→Library→Detail |
| PDF Event | FAIL | GEMINI_UNAVAILABLE, 재시도 실패, Event 없음. PROVIDER_DEGRADED |
| Gmail Event | NOT TESTABLE | 사용자가 지정한 제목 테스트: 소유자 Gmail ITEM 정확 일치 0건 |
| Drive Event | NOT TESTABLE | 기존 연결 TEST Doc에 명확한 미래 일정 내용 없음. 사용자 문서 수정 안 함 |
| Google Calendar rendering | PASS | 실제 Home 10/5 표시·상세 Source 연결 확인 |
| AI Event rendering (요청 Source) | NOT TESTABLE | PDF Event 생성 실패, 적절한 Gmail/Drive TEST Event 없음 |
| PDF extracted Evidence | NOT TESTABLE | AI 결과가 없어 Event Evidence 생성 안 됨 |
| Google event Source/detail | PASS | Home 상세에 일정 근거와 동일 ITEM 링크 표시 |
| AI failure UI | PASS | 자료 저장 유지, 분석 실패 표시·다시 시도 버튼, 페이지 정상 |
| AI retry request | PASS | 실제 버튼 실행 |
| AI retry recovery | FAIL | 재시도 후에도 GEMINI_UNAVAILABLE |

PDF TEST: E2E_PDF_EVENT_20261013.pdf. 본문은 2026-10-24 14:00 KST 설명회, 행동 의무 없음. ITEM 1b32e02b-d1f0-437a-a396-88f2f85e886b. 실제 저장된 processing_status=failed, processing_error=GEMINI_UNAVAILABLE. 코드 결함이라고 단정하지 않고 provider 장애로 분리한다. 테스트 자료 삭제 UI 안전성을 확인하지 않았으므로 ITEM은 보존했다.

최초 reportlab 압축 PDF는 filter chain으로 PDF_LAYOUT_NEEDS_REVIEW(422), 동일 세션 재시도는 UPLOAD_EXPIRED(410)였다. 기존 보안 파서 제한을 완화하지 않고 pageCompression=0의 일반 텍스트 PDF로 새 업로드를 실행해 추출/저장에 성공했다. 첫 파일 거절과 최종 저장 결과를 혼동하지 않는다.

미지정 Gmail의 일정 내용 및 Calendar 전체 metadata 조회는 자동 승인 검토가 개인정보 범위 초과로 거부했다. 우회하지 않았다. Gmail은 사용자가 지정한 정확한 제목만 확인했고, Calendar는 필요한 start/end/status 등 최소 필드만 안전하게 조회했다. 더 넓은 원문 조회는 진행하지 않았다.

## SETTINGS / NAVIGATION / SECURITY

| 항목 | 결과 |
|---|---|
| Gmail actual status | PASS, connected/정상 |
| Drive actual status | PASS, connected/정상 |
| Calendar actual status | PASS, connected/정상 |
| Sync buttons | PASS, 각 실제 수집 결과 확인 |
| Last sync | PASS, DB 시각과 재로그인/refresh UI 일치 |
| Route | PASS, 기존 / /library /actions /settings 유지 |
| Refresh | PASS, Production Planner/Home/Settings, Local Home |
| Back | PASS, Drive filter→Library |
| Forward | PASS, Library→Drive filter |
| Slide animation | NOT TESTABLE, 화면 이동은 확인했지만 모션 전체를 기록/판정하지 않음 |
| Persistence | PASS, TEST Action 실제 DB/refresh/relogin |
| Ownership: current account writes | PASS, TEST row user_id 일치 |
| Cross-user exposure actual browser | NOT TESTABLE, 두 번째 계정 세션 없음 |

LOCAL: Home 로딩 수정·Quick Todo·Planner 연동·완료/복원/삭제·새로고침 PASS. 운영 sync/PDF 결과를 Local sync/PDF PASS로 전용하지 않는다.

PRODUCTION: Manual Planner CRUD·refresh·relogin·Home 연동·실제 Google sync PASS. Home Today 표시 지연은 남아 있음(수정 미배포). PDF Event는 provider 장애로 실패. 전체 CORE READY 아님.

## TESTS

| 명령 | 결과 |
|---|---|
| npm test | PASS 271/271, 기존 270에서 1개 추가 |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS |
| git diff --check | PASS |

추가 회귀: 자료 Event 로딩 중에도 오늘 Manual Action 제목/시간 표시 유지. 기존 Planner CRUD/ownership 회귀 유지. 실제 다른 계정 브라우저 검증을 단위 테스트로 대체하지 않았다.

## 증거 및 제한

로컬 작업 공간의 `pre-classification/`에 planner-create-refresh.jpg, home-moved-action.jpg, home-today-action.jpg, planner-complete-refresh.jpg, planner-relogin.jpg, gmail-sync-1/2.jpg, drive-sync-1/2/3.jpg, calendar-sync-1/2/3.jpg, home-google-calendar.jpg, drive-library.jpg, pdf-analysis-failed.jpg, local-home-quick-todo.jpg, home-deleted-refresh.jpg를 보관했다. 계정 화면을 포함하는 캡처는 이번 코드 커밋에 포함하지 않는다.

home-today-action.jpg는 TEST 삭제 전 조회된 Home 화면이다. 다른 탭에서 삭제한 뒤 기존 탭은 refresh 전 stale 상태가 남았으나 refresh 후 제거를 별도로 확인했다. 실시간 다른 탭 자동 반영을 검증한 것으로 주장하지 않는다.

DB Migration: NO

AI Library Classification: NOT STARTED

Promotional: OFF, 활성화 변경 없음

아래 상태는 실제 검증 보고를 작성한 시점의 기록이다. 후속 사용자 요청으로 Home 로딩 분리 수정·회귀 테스트·관련 문서의 커밋/푸시를 승인받았다. AI 분석 실패와 미검증 항목의 상태는 그대로 유지하며 CORE_READY로 변경하지 않는다.

Commit (검증 시점): NO

Push (검증 시점): NO

Deploy (검증 시점): NO
