# Local UI Preview — 2026-10-08

RESULT: LOCAL_UI_READY

## Sidebar 펼치기 / 접기 — 2026-10-09

- 왼쪽 메뉴 상단 버튼으로 192px 펼침 / 64px 아이콘 모드 전환.
- 접은 메뉴도 오늘/자료/할 일/설정으로 이동하며 tooltip·접근성 이름을 유지한다.
- 브라우저 localStorage에 표시 설정만 저장해 페이지 이동·새로고침 후 유지한다.
  storage가 불가능하면 현재 세션의 메모리 상태로 토글을 제공한다.
- 모바일은 기존 하단 메뉴 그대로이며 Sidebar는 숨긴다.
- 변경 파일: src/components/shell/sidebar.tsx(신규), navigation.tsx, app-shell.tsx.
- 펼침/접힘·아이콘 메뉴 이동·상태 기억·모바일·overflow 확인 완료.
- 기존 favicon.ico 404는 별도 리소스 누락으로 구분했다. 사이드바 관련 브라우저 오류 없음.
- npm test 174/174, typecheck, lint, build, diff-check PASS.
- 로컬 3001 유지. Production deploy / Commit / Push: NO.

사용자 제공 첫 번째 캡처의 밝은 배경·옅은 블루·검색 히어로를 로그인 이후 공통 Shell에 적용했다.
두 번째·세 번째 캡처는 목록/달력/자료 행 구조 참고로 사용했다. Landing은 변경하지 않았다.

## Navigation — 로그인 이후 UI 재구성 요청

- Sidebar / Mobile bottom navigation: 오늘 / 자료 / 할 일 / 설정. 검색 메뉴 제거.
- Header: 간결한 HUB 브랜드, 자료 추가 버튼, 실제 계정 이메일 첫 글자 아바타.
  중복 상단 검색창과 직접 노출 로그아웃을 제거했다.
- 자료 추가: 기존 PDF·이미지 업로드 / 직접 텍스트 입력으로 이동하고 패널을 연다.
  같은 Library 안에서 두 입력 방식 간 이동할 때도 기존 패널이 열린다.
- Profile: 계정 이메일 / 설정·연결 관리 / 기존 local scope 로그아웃. 새 계정 기능 없음.
  Escape와 바깥 클릭으로 닫기, Escape 시 버튼으로 focus 복귀.
- 공통 배경 톤을 Settings/Detail에도 적용하되 내부 기능과 구조는 유지했다.
- `/search`, 빈 q, 공백 q, 배열 q는 Home으로 redirect한다. 결과 검색어를 지워도 Home으로 이동한다.
  독립 빈 검색 시작 페이지와 추천 검색 카드를 제거했다.
- AI 생성 요약과 독립 Event 검색 필드는 기존 계약에 없다. 실제 검색 정리를 유지하며
  Calendar는 관련 자료와 기존 Detail 일정으로 연결한다. backend에 새 계약을 추가하지 않는다.
- Settings/Detail, GoogleConnectionPanel, LogoutButton, UploadControls, ManualTextControls 원본 보존.
- Navigation 중 실제 Actions 응답을 지연해 Header/Bottom nav 유지 + 본문 skeleton을 확인했다.
  full-screen loading 없음.
- 1440 / 1280 / 768 / 390 / 360에서 Home/Search/Library/Actions/Settings/Detail 30개 화면 PASS.
  overflow 없음, 실제 ITEM 73개 및 open Action 2개. 빈 Search redirect, Home 검색,
  자료 추가 두 경로, Profile/설정 이동, QA 세션 실제 로그아웃 PASS. 브라우저 오류 0.
- Gmail/Drive/Calendar/Upload/Manual/Search/Actions/Auth 회귀 테스트 포함 npm test 174/174 PASS.
  typecheck / lint / build / git diff --check PASS. 보호 파일 해시 차이 0.
- RLS/API/DB/migration/Auth/OAuth/Sync backend는 변경하지 않았다. Google 신규 연결·재수집,
  새 업로드·OCR·AI 분석·실제 사용자 Action 완료/복원 쓰기는 재실행하지 않았다.
- 로컬 사용자 확인 URL: http://localhost:3001 (자동 검증은 http://127.0.0.1:3001).
  로컬 dev server 실행 유지. Production deploy / Commit / Push: NO.
- 이번 추가 변경: src/components/shell/navigation.tsx, top-bar.tsx, app-shell.tsx,
  header-menus.tsx(신규), src/components/workspace/demo-frame.module.css,
  src/app/search/page.tsx, src/components/search/search-workspace.tsx,
  src/app/library/page.tsx, src/components/library/material-focus.tsx(신규), SPEC.md 41절.
  UI 기준 변경만 문서화했고 Production 동결을 명시했다.

## Search — 추가 요청 반영

- 추가 검색 캡처의 좌측 결과 / 우측 원문 근거 구조를 데모의 밝은 블루 톤으로 적용했다.
- 둥근 검색창, 홈 이동, 출처 칩, 접을 수 있는 형식·원본 날짜·의미 검색 옵션을 제공한다.
- 반환된 Action에는 확정 날짜만 날짜 카드·D-Day로 표시한다. 날짜 미확정 상태를 유지한다.
- 결과의 번호를 원문 근거 카드와 연결한다. 같은 원문 발췌는 번호를 재사용한다.
- API에 AI 요약 답변 필드가 없어 ‘검색 정리’는 현재 반환 결과의 실제 건수만 요약한다.
  전체 검색 대상 건수, 현재 불러온 결과 건수, 추가 페이지 여부를 구분한다.
- 기존 요청·취소·429 재시도·cursor pagination·필터·ActionStateButton 동작을 유지한다.
- 검색 시작은 Home이다. 검색어가 있는 결과에서만 필터·검색어 수정 UI를 제공한다.
- Search API, 검색 ranking, Auth, Sync, Detail 코드는 수정하지 않았다.
- 3001에서 실제 할 일 검색 및 자료 검색을 Desktop 1440 / Mobile 390·320으로 확인했다.
  overflow 없음, 근거 번호 이동·상세 이동·출처 필터·날짜 검증·빈 결과·홈 이동 PASS.
  브라우저 오류 및 데이터 수정 요청 0.
- npm test 174/174, typecheck, lint, build, git diff --check PASS.
- 추가 수정 파일: src/app/search/page.tsx, src/app/search/loading.tsx,
  src/components/search/search-workspace.tsx, src/components/search/search-demo-results.tsx.

## Home

- 큰 검색창과 Gmail/Drive/Calendar/업로드/직접입력 진입을 유지한다.
- 추천 질문 대신 확정된 미완료 마감 최대 4개, 이번 주 일정 최대 3개, 최근 자료 3개를 표시한다.
- 지난 기한은 별도 안내하고 날짜 미확정 Action은 확정 D-Day로 승격하지 않는다.
- importance 필드는 없어 중요도를 생성하거나 최근 자료를 중요 자료로 단정하지 않는다.

## Actions / Schedule

- 기한 지남 / 이번 주 / 다음 주 / 이후 일정 / 날짜·조건 확인 필요로 그룹화한다.
- 진행 중/완료, 유형, 목록/달력, 월 이동 및 날짜 선택 필터를 제공한다.
- 기존 ActionStateButton과 상태 PATCH를 그대로 재사용한다.
- 저장된 confirmed Action deadline, Calendar 원본 일정, 검증된 AI EventObservation을 분리한다.
- Calendar cancelled는 표시하지 않고 all-day 종료일은 exclusive로 처리한다.
- AI의 날짜 확인 필요 observation은 달력 날짜로 임의 확정하지 않는다.
- 일정은 기존 ITEM 목록/Detail GET으로 최신 100개부터 3개 동시 요청으로 조회한다.
  자료가 더 있으면 Actions에서 다음 자료 묶음을 추가 조회할 수 있다. 로딩 범위와 실패를 표시한다.

## Library

- 기존 서버 필터와 cursor pagination을 유지한다.
- 출처 칩, 주제, 분류, 처리 상태, 형식, 추가일 UTC 필터를 제공한다.
- 현재 페이지 제목/본문 검색과 기존 Search로 이동하는 전체 자료 검색을 구분한다.
- 추가 count 조회가 실패해도 성공한 자료 목록을 유지한다.
- count는 동일 필터의 최대 100개 조회가 끝나면 실제 건수, 계속되면 100개 이상으로 표시한다.
- 기존 Detail GET으로 분석 artifact와 현재 연결 Evidence의 Action/Deadline, 독립 Event 개수를 표시한다.
- processing completed만으로 AI 분석 완료라고 주장하지 않는다.
- UploadControls, ManualTextControls 구현과 동작은 변경하지 않았다.

## Modified / Added Files

- src/components/home/today-view.tsx
- src/app/actions/page.tsx
- src/app/actions/loading.tsx
- src/app/library/page.tsx
- src/app/library/loading.tsx
- src/components/shell/app-shell.tsx
- src/components/shell/navigation.tsx
- src/components/shell/top-bar.tsx
- src/components/shell/header-menus.tsx
- src/components/library/material-focus.tsx
- src/app/search/page.tsx
- src/app/search/loading.tsx
- src/components/search/search-workspace.tsx
- src/components/search/search-demo-results.tsx
- src/components/actions/schedule-model.ts
- src/components/actions/schedule-workspace.tsx
- src/components/actions/use-workspace-data.ts
- src/components/library/library-list.tsx
- src/components/library/library-toolbar.tsx
- src/components/workspace/workspace-ui.tsx
- src/components/workspace/request-clock.ts
- src/components/workspace/demo-frame.module.css
- scripts/test-workspace-ui.mjs
- package.json: 기존 npm test에 UI 날짜 회귀검사 연결. 의존성 변경 없음.
- docs/LOCAL_UI_PREVIEW.md
- SPEC.md: 로컬 검색 중심 UI 기준 41절.

## Verification

- Local URL: http://127.0.0.1:3001
- Desktop 1440 / Mobile 390: Home, Actions, Library HTTP 200; overflow 없음.
- 실제 저장 ITEM 73개, open Action 2개로 검증. mock 데이터 삽입 없음.
- Home 검색, Detail 이동, Navigation, 소스 필터, 진행/완료 조회,
  월 이동/오늘/날짜 필터, 기존 Upload/Manual 패널 열기 PASS.
- 브라우저 오류 0. 검증 중 자료 생성·수정/완료 상태 변경·AI 분석·Google 재수집 요청 0.
- 캡처/검증 스크립트/로그/보존 원본은 .git/local-ui-baseline 아래에만 저장한다.
- npm test: 174/174 PASS (기존 167 + KST/날짜 그룹/Calendar exclusive/독립 일정 7).
- npm run typecheck / lint / build / git diff --check: PASS.
- 보호 파일 해시: 작업 시작 시 Landing/Auth/OAuth/Sync/Manual/Upload/API/DB 원본과 동일.
- 기존 사용자 미커밋 파일 및 untracked 파일을 보존했다.

Production deploy: NO
Commit: NO
Push: NO
Reset / clean / stash / checkout: NO

Google 로그인/OAuth 승인 흐름 자체, Google 재수집, 새 업로드/실제 OCR/AI 분석은 재실행하지 않았다.
해당 기능 코드 보존과 기존 회귀검사 PASS를 실제 재수집/새 분석 E2E 성공으로 확대 해석하지 않는다.


2026-10-09 배경 조정: 보호된 AppShell 기본 배경을 #fdfdfd로, 그라데이션을 #f8f9fc / #fcfcfe로 옅게 바꿨다. 버튼·선택 색상과 기능은 유지한다. 로컬 3001만 적용, 배포/commit/push 없음.

2026-10-09 통합 확인: 이전의 읽기 전용 검증 이후 사용자 요청으로 실제 Sync/합성 Manual/AI/분류 수정/Action 완료·복원 smoke를 추가했다. Upload prepare 503 WORKER_UNAVAILABLE 및 개발 모드 Search redirect Performance 오류가 남아 결과는 PARTIAL이다. 상세는 LOCAL_INTEGRATION_REVIEW.md 참조.
