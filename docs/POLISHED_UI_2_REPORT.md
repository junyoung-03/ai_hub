# POLISHED UI 2.0 + FULL-STACK INTEGRATION

2026-10-05 · RESULT: **NEEDS_BACKEND_FIX**

기존 API로 가능한 화면 조회·수집·OCR·검색 통합을 구현했다. 제품 핵심인 사용자 분류 수정과
입력 경로 전체의 분석 자동 연결이 아직 없으므로 전체 MVP 완료로 판정하지 않는다.
기존 Phase/Search/Upload 완료 판정은 그대로 유지한다.

## 1. 기존 polished 대비 개선

ZIP의 목록·카드 조합과 원문/분석 구조를 유지하고 글자·여백·검색 비중을 확대했다.
프로토타입 mock.ts, PrototypeContext, 로컬 완료·분류 상태는 production에 가져오지 않았다.
Today 카드의 중복 정보는 요약하고 상세한 조건·요구사항·근거는 Actions/Detail에서 확인한다.

## 2. Design System

한국어 sans-serif 시스템 font, page 28px / section 18~20px / body 15~16px / metadata 13px.
중립 배경 #f7f8fb, primary #5146bc, border #e3e5ed. 제한된 indigo accent, shadow 최소화.
panel / field / primary·secondary button을 공통화하고 focus outline·44px 버튼을 적용했다.

## 3. Today

큰 검색 진입 → 가까운 확정 마감 → 확인 필요·날짜 미정 → 최근 6 ITEM.
Action은 Search의 기존 SQL 조회, 최근 ITEM은 기존 session query. 가짜 통계 없음.
임박한 항목은 조회된 cursor 페이지 범위이며 추가 페이지는 더 불러오기 지원.

## 4. Search

실제 POST /api/v1/search. Source/Format/원본 날짜 필터, 350ms debounce, 요청 취소,
cursor pagination, 결과·인용·페이지/문자/Drive tab 위치·Detail 이동.
semantic 기본 false. 실제 서버 disabled 상태에서 선택 시 keyword_only/degraded 배너 확인.
생성형 답변/Chat 없음. 429 Retry-After 대기, 만료 cursor는 재검색, 역전 날짜 오류 처리.

## 5. Detail

원문이 넓은 1.65:1 Desktop grid, Mobile 원문/분석 anchor 전환.
AI/User/Effective 분류, 분석 유무·시각, requirements/conditions/start/deadline/D-Day,
current/history Evidence와 nested locator, 행사 관찰값 별도 표시.
Upload 원본 접근 GET으로 링크 준비, Similar GET의 not_indexed/empty/error 상태.
Gmail에만 기존 수동 analyze API 버튼을 연결하고 본문 외부 전송을 안내한다.

## 6. Library

Source·Date 기본 필터와 추가 필터, 간결한 목록 metadata, 기존 cursor 유지.
Upload 및 성공 후 refresh, 원본 source 유지. Library 날짜는 기존 추가일 UTC 기준이다.

## 7. Action / D-Day

open Action 조회·유형/확인 필요 필터·관련 ITEM·Evidence. 완료/복원 쓰기는 미구현 GAP.
confirmed deadline만 KST D-Day 표시. 행사일에서 Action 생성 없음.
완료 Action을 조회할 API가 없어 완료 탭을 만들지 않았다.

## 8. Upload

기존 runUpload/OCR worker/checkpoint 재사용. 파일 선택·업로드·검증/추출·OCR·저장·완료·오류·재시도·취소.
실제 OCR progress만 페이지별 표시, 다른 단계의 가짜 percentage 없음.
새 파일은 input·checkpoint·진행 상태를 함께 초기화한다. 실제 합성 scan PDF와 JPEG 처리 성공.
완료 합성 ITEM은 검증용으로 유지하며 삭제하지 않았다.

## 9. Settings

Gmail 연결/수집, Drive scope upgrade/폴더·최대 20 file IDs 수집,
Calendar scope upgrade/primary 수집, Google 전체 연결 해제.
저장 scopes의 공개 capability boolean으로 권한을 표시한다. 연결 해제 안내와 데이터 삭제를 구분한다.
현재 Google 연결 권한은 충분했으며 scope 확대/연결 해제는 실제 실행하지 않았다.

## 10. Backend / API 연결

Auth, ITEM list/detail, Search, Similar, Action 읽기, Classification 읽기,
Gmail/Drive/Calendar 수집, Upload, original access 등 기존 12개 영역 연결.
독립 Action API를 새로 설계하지 않고 Search 계약을 재사용했다.
유일한 공개 API 보완은 connections.capabilities 추가. DB·RPC·Migration 변경 없음.

## 11. Desktop 검증

실제 로그인 → Today / keyword Search → Drive Detail / Settings 수집 / Library 업로드 → Detail.
1440px Detail 및 1280px Search·Actions의 가로 overflow 없음.
Search pagination 20 → 40 결과, 중복 ITEM 없음 확인.
Google 재수집: Gmail 기존 50·실패 0 / Drive 기존 1·실패 0 / Calendar 기존 1·실패 0.
Gmail 초기 실행의 신규 수를 별도 저장하지 않았으므로 첫 실행의 정확한 신규 건수는 주장하지 않는다.

## 12. Mobile 검증

390px Settings, Library, Detail, Search, Actions에서 document width overflow 없음.
JPEG 실제 OCR 완료, 한국어·영어·숫자 본문과 Detail 확인. Bottom nav와 원문/분석 이동 확인.
Desktop Chromium의 viewport emulation이며 Android/iOS 실제 기기 성능 검증은 아니다.

## 13. Loading / Empty / Error

route skeleton, Search/Similar/Upload/Google 작업별 진행 상태, 미수집/미분류/미색인/no-result,
실패·재시도·429·cursor expiry·partial/degraded 상태 구현.
실제 검색 결과 없음·degraded·역전 날짜 오류·OCR 완료·수집 완료를 브라우저에서 확인했다.
네트워크 오류/429/410 전체 UI를 실제 환경에서 강제로 발생시키지는 않았다.

## 14. Accessibility

lang=ko, skip link, main/section heading, input label, aria-current/pressed,
status/alert/live region, keyboard focus, safe-area bottom navigation, motion-safe skeleton.
자동 접근성 도구 또는 스크린리더 전체 감사는 미실행이다.

## 15. 기존 로직 재사용

requirePageUser/requireUser/session query, listItems/getItemDetail, cursor/parser,
effectiveClassification, formatters/locatorLabels, Google OAuth·수집·disconnect,
runUpload·OCR/checkpoint/Storage, Search/Similar service를 유지한다.
User Edited 데이터 쓰기, Google 원본 삭제, 개인 semantic backfill, Notion 수정 없음.

## 16. 변경 파일

- src/app/{globals.css,page.tsx,loading.tsx}
- src/app/{search,actions,library,settings}/page.tsx
- src/app/items/[itemId]/page.tsx
- src/app/api/v1/connections/route.ts
- src/components/shell/{app-shell,navigation}.tsx
- src/components/search/{search-workspace,search-results}.tsx
- src/components/items/{detail-tools,item-summary,library-filters,item-loading}.tsx
- src/components/connections/google-connection-panel.tsx
- src/components/uploads/upload-controls.tsx
- src/lib/items/presentation.ts / src/lib/google/connections.ts
- src/types/search-ui.ts / scripts/test-ui.mjs / package.json / next.config.ts
- SPEC.md / API_SPEC.md / docs/PROJECT_STATE.md / 본 보고서 / 검증 JPG

작업 시작 전 존재한 Backend·Migration·검증 script 변경은 이 UI 작업의 변경으로 계산하지 않는다.

## 17. Backend GAP

1. Classification PATCH route 없음: User Edited 분류 변경 UI를 임시 저장으로 대체하지 않음.
2. Action status PATCH·독립 목록 GET 없음: open만 Search로 조회, 완료/복원·완료 목록 불가.
3. analyze는 Gmail/email에만 존재: Drive/Calendar/Upload 자동 분류·Action 추출 연결 미구현.
4. Google 원본 읽기/수집과 Search는 가능하지만 신규 ITEM 전체의 분석/색인 자동 연쇄는 미완료.
5. 서비스 데이터 삭제 route 없음. 삭제 UI를 임의 생성하지 않음.
6. 현재 개인 corpus 의미 색인 없음: 실제 keyword fallback 유지, Similar not_indexed 정상 표시.

## 18. Tests / Build

최종 npm test 136 PASS / typecheck PASS / lint PASS / build PASS / check:supabase Auth read PASS / git diff --check PASS. UI 회귀 테스트는 KST 자정/정확한 마감시각,
needs_review/none/completed, 부분 Drive grant와 공개 capability·민감 필드 제외를 검증한다.
개발 서버 sandbox 네트워크 차단으로 최초 로그인 callback 실패, 네트워크 허용 후 실제 로그인 PASS.
제품 인증 코드는 변경하지 않았다.

## 19. 남은 P0

사용자 분류 수정 계약의 실제 구현 및 User Edited 저장 E2E.
Gmail 외 입력의 AI 분석·Action 추출과 신규 ITEM 처리 연쇄에 대한 승인된 통합 계약/구현.
전체 MVP는 이 두 핵심 흐름이 완료되기 전 완료로 표시하지 않는다.

## 20. 남은 P1 / P2

P1: Action 완료/복원·완료 목록, background sync/처리 상태 갱신, Similar를 위한 승인된 색인 범위,
실제 Vercel/Linux 배포, Android/iOS 성능, 오류·pagination 경계 Browser E2E 확대.
P2: Evidence 원문 범위 highlight, 추가 접근성 감사, importance 별도 계약 및 data management.
개인 semantic backfill은 계속 별도 승인 필요.

## 21. 실제 MVP 완료 여부

**아니오.** 현 API로 가능한 UI 통합은 사용할 수 있으나 Backend GAP 때문에 전체 MVP 미완료.
사용자에게 가짜 분류 편집/완료 상태/검색 답변을 제공하지 않는다.

## 22. 실제 완료율

기존 API 연결 영역은 12/12(100%). 이 수치는 전체 기능·제품 MVP 완료율이 아니다.
전체 MVP의 확정된 검증 항목·가중치가 없어 근거 없는 단일 백분율을 부여하지 않는다.
전체 판정은 NEEDS_BACKEND_FIX로 유지한다.
