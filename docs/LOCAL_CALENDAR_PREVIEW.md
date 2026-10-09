# 할 일 · 일정 — 로컬 전체 캘린더 (2026-10-08)

RESULT: LOCAL_CALENDAR_READY

## Calendar

- 목록/캘린더 토글을 페이지 제목 오른쪽에 배치했다. 전환은 client state이며 reload하지 않는다.
- 캘린더 모드는 본문 전체 폭의 월간 7열 grid다. Desktop/Tablet cell 최소 높이 112px.
- 이전/다음 달과 오늘 이동을 제공한다. 기존 조회 범위 안에서 표시하며 새 API를 요청하지 않는다.
- Deadline은 옅은 주황 배경과 diamond, Calendar Event는 블루 채움과 dot,
  AI EventObservation은 블루 테두리와 square로 구분한다.
- cell에 제목 및 가능한 시간, 최대 3개 항목을 표시한다. 초과분은 +N으로 날짜 Agenda에 연결한다.
- 날짜 선택 시 아래 Agenda에 해당 날짜 항목을 모두 표시한다.
- 항목 클릭은 native dialog로 제목/날짜/D-Day 또는 시간/출처/Evidence/자료 링크를 보여준다.
  Escape/닫기/바깥 클릭으로 닫고 기존 버튼으로 focus를 돌려준다.
- 자료 보기는 기존 /items/[itemId]로 이동한다. Action은 기존 완료 처리 컨트롤을 사용하며,
  Event에는 완료 버튼을 추가하지 않는다. Action 상태 변경 시 열린 상세를 닫아 이전 상태 표시를 방지한다.

## List

- 기한 지남 / 이번 주 / 다음 주 / 이후 일정 / 날짜·조건 확인 필요 그룹을 유지했다.
- 진행 중/완료, 유형, 마감일순, 출처·근거·D-Day·기존 완료/복원 동작을 유지했다.
- 목록 모드의 보조 달력과 날짜 필터도 유지했다.

## Data

- Action/Deadline: 기존 actions API의 저장된 confirmed 날짜만 달력에 표시한다.
  needs_review/날짜 미정 Action은 목록의 확인 필요 그룹에 남는다.
- Calendar: 기존 ITEM detail의 원본 시작/종료와 상태를 사용한다.
- EventObservation: 기존 confirmed observation을 별도 Event로 표시한다.
- Source/Evidence: 기존 Action sources 및 Event 근거와 관련 자료 링크를 사용한다.
- 데이터 타입은 표시용 discriminated union만 사용한다. 저장 모델을 합치거나 Event를 Action으로 만들지 않는다.
- 기존 최근 100개 ITEM부터 조회하는 범위와 추가 조회·진행·오류 안내를 유지했다.
  이번 검증 계정의 실제 자료 73개를 조회했다. 월별 신규 backend 조회는 추가하지 않았다.

## Responsive / Loading

- Desktop 1440/1280, Tablet 768: 전체 폭 7열과 제목 chip, 말줄임/tooltip.
- Mobile 390/360: 날짜와 유형 표시의 월간 grid → 선택 날짜 Agenda → 항목 상세.
  작은 cell 안에 읽기 어려운 제목을 억지로 넣지 않는다.
- 5개 너비 모두 horizontal overflow 없음. 상세 dialog도 viewport 안에 들어간다.
- 전체 화면 loading 없음. Calendar 데이터 요청을 의도적으로 지연해 AppShell/Header/Bottom nav
  유지와 본문 skeleton을 확인했다. 월 변경은 조회된 데이터를 즉시 사용한다.

## Regression / Verification

- 실제 마감/Calendar Event/AI Event 각각의 클릭과 상세, 원문 근거, 기존 Detail 이동 PASS.
- 이전/다음 월, 선택 날짜 Agenda, 목록 복귀, 기간 그룹 PASS. 브라우저 오류 0.
- 검증 중 자료 생성·수정·Action 완료/복원 요청 0. mock 삽입 없음.
- Home 분기 코드는 작업 전과 동일하다. Home/Library/Search/Settings/Auth/RLS/API/Google/DB 및
  Landing을 포함한 Actions 외 src 파일은 승인된 Actions page 제목 이동 외 해시 차이 0.
- Google 신규 OAuth/Sync, 업로드/OCR/AI 분석은 재실행하지 않았다. 기존 로컬 변경은 보존했다.
- npm test: 174/174 PASS.
- npm run typecheck: PASS.
- npm run lint: PASS.
- npm run build: PASS (배포하지 않음).
- git diff --check: PASS.
- 검증 스크립트/로그/캡처는 .git/local-ui-baseline/full-calendar에 보존한다.

## 수정 파일

- src/app/actions/page.tsx: 제목/설명을 보기 토글과 같은 UI 영역으로 이동.
- src/components/actions/schedule-workspace.tsx: 기존 목록 유지, 전체 달력 분기 연결.
- src/components/actions/full-month-calendar.tsx: 신규 전체 달력/모바일 Agenda/항목 상세.
- docs/LOCAL_CALENDAR_PREVIEW.md: 구현·검증·조회 범위 기록.

로컬 서버 실행 유지: http://localhost:3001/actions

Production deploy: NO
Commit: NO
Push: NO

2026-10-09 후속 캡처 반영: 캘린더 모드의 진행/완료·유형·정렬 줄을 숨기고 월 이동·범례·전체 달력이 바로 이어지도록 정리했다. 목록 필터는 유지하며 적용 중인 필터가 있으면 해제 안내를 표시한다. 요일을 좌측 정렬하고 오늘을 원형 표시로, 일정 칩 간격과 cell 높이를 참고에 맞췄다. 데모 배경과 실제 데이터는 유지한다.
