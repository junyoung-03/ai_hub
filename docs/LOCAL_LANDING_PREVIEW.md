# 검색 중심 랜딩 — 2026-10-09

RESULT: LOCAL_LANDING_READY

- 사용자 참고 이미지와 현재 서비스의 거의 흰 배경·옅은 블루·검색 중심 구성을 연결했다.
- Header: HUB / 기능 / 이용 방법 / 데이터 안내 / 로그인 / 기존 Google 시작 버튼.
- Hero: 큰 검색 메시지, 부제, 검색 모양의 로그인 진입 CTA, 소스 라벨, 장식 아이콘.
  로그인 전에는 검색 CTA가 /login으로, 로그인 상태에서는 기존 /search로 연결된다.
- Preview: 현재 Home의 오늘/자료/할 일/설정, 검색, 마감, 일정 구조를 HTML로 표현했다.
  설명용 샘플임을 화면과 caption에 명시한다. 실제 사용자 자료를 공개하지 않는다.
- 아래 영역: 모으기/찾기/마감·일정, 연결→검색→근거 확인의 이용 흐름,
  Google 원본 유지/연결 해제/AI 전송 안내, 마지막 시작 CTA, 법적 링크와 운영 문의 이메일.
- 확정된 요금 계약이 없어 가격·플랜·무료 이용 보장은 추가하지 않았다.
- 이전 LandingPage 원본은 .git/local-ui-baseline/landing-refresh/landing-page.tsx에 보존했다.
  기존 랜딩 하위 컴포넌트는 수정·삭제하지 않았다.

## 연결 및 범위

- /landing: 로그인 여부와 관계없이 소개 화면. 로그인 시 ‘AI Hub 열기’ 링크.
- /: 기존 root의 분기 유지. 비로그인 시 새 Landing, 로그인 시 기존 TodayView.
- 기존 LandingAuthButton / GoogleSignInButton 재사용. Auth/OAuth handler·scope·callback 변경 없음.
- 기존 Home/Library/Search/Actions/Settings 및 backend/DB/RLS/Sync 코드는 변경하지 않았다.
- OAuth 외부 승인·Google 재수집·실제 자료 생성/변경은 검증 중 실행하지 않았다.

## 검증

- 1440 / 1280 / 768 / 390 / 360: HTTP 200, 가로 overflow 없음.
- 익명 Home, /landing, 로그인 진입, 섹션 anchor, /privacy, /terms 정상.
- 실제 로그인 QA 세션의 Home과 /landing CTA 분기 PASS.
- 기존 기능/source 파일 해시 차이 0 (승인된 LandingPage 연결 변경 제외).
- npm test: 174/174 PASS.
- npm run typecheck / npm run lint / npm run build / git diff --check: PASS.
- 로컬 preview/capture/log: .git/local-ui-baseline/landing-refresh.

## 수정 파일

- src/components/landing/search-first-landing.tsx: 새 랜딩과 화면 예시.
- src/components/landing/landing-page.tsx: 기존 props/route를 유지한 새 랜딩 연결.
- docs/LOCAL_LANDING_PREVIEW.md: 검증 및 한계 기록.

Local URL: http://localhost:3001/landing
서버 실행 유지.

Production deploy: NO
Commit: NO
Push: NO
