# AGENTS.md

이 파일은 이 저장소에서 작업하는 Codex 및 기타 코딩 에이전트가 따라야 할 개발 규칙을 정의한다.

---

## 1. Source of Truth

이 프로젝트의 제품 및 개발 기준은 다음 우선순위를 따른다.

1. Notion 「AI 통합 정보 허브 — 서비스 기획 및 개발 기준서 v0.5」
2. `docs/SPEC.md` — 저장소 내 개발용 상세 명세
3. `README.md` — 프로젝트 개요 및 실행 안내

규칙:

- 기존 기준과 충돌하는 기능, 데이터 구조, 화면, API를 임의로 추가하지 않는다.
- 기준이 불명확하거나 서로 충돌하면 추측하여 구현하지 않는다.
- 변경이 필요하면 기존 기준과 무엇이 달라지는지 먼저 명확히 제시한다.
- 구현 편의를 위해 제품 기준을 임의로 변경하지 않는다.
- `docs/SPEC.md`가 아직 없거나 필요한 내용이 누락되어 있으면 임의 확정하지 말고 확인이 필요한 항목으로 남긴다.

---

## 2. Product Core

서비스의 핵심 구조는 다음 세 축이다.

- **COLLECT** — 정보를 모은다.
- **FIND** — AI가 분류하고 찾아준다.
- **ACT** — 해야 할 일을 놓치지 않게 한다.

v1에서는 이 세 축에 직접 기여하지 않는 기능을 임의로 추가하지 않는다.

### COLLECT

자동수집:
- Gmail
- Google Drive
- Google Calendar

직접입력:
- PDF
- 이미지
- 스크린샷
- 일반 문서
- 텍스트
- 클립보드 붙여넣기

### FIND

- AI 자동분류
- 자연어 통합검색
- Keyword Search
- Vector Search
- Metadata Search
- 검색 답변 시 가능한 경우 `Answer + Source + Evidence` 제공
- 관련 정보가 없으면 추측하지 않는다.

### ACT

- Action 추출
- Deadline 추출
- Requirements / Conditions 추출
- D-Day 관리
- Source / Evidence 연결
- 동일 Action 중복 병합

---

## 3. Unified ITEM Rule

입력 경로와 형식이 달라도 시스템 내부에서는 모두 **Unified ITEM**으로 처리한다.

다음 입력을 별도 서비스 모델로 분리하지 않는다.

- Gmail
- Google Drive
- Google Calendar
- PDF
- 이미지
- 스크린샷
- 일반 문서
- 텍스트

모든 ITEM은 원본 Source를 추적할 수 있어야 한다.

---

## 4. Action / Deadline Rules

다음 규칙은 반드시 지킨다.

1. 날짜가 있다는 이유만으로 Action을 생성하지 않는다.
2. 사용자가 실제로 해야 하거나 선택해야 하는 행동이 있을 때만 Action을 생성한다.
3. 날짜 근거가 없으면 Deadline을 확정하지 않는다.
4. 날짜가 불명확하면 `마감일 확인 필요` 상태로 처리한다.
5. 행사 날짜와 신청 마감일을 구분한다.
6. 신청 시작일과 마감일을 구분한다.
7. 동일 Action이 여러 Source에서 발견되면 Action을 중복 생성하지 않고 Source를 여러 개 연결한다.
8. 출처 간 Deadline이 충돌하고 최신 공지가 명확하지 않으면 AI가 임의 선택하지 않는다.
9. Deadline, 제출 의무, 적용조건에는 추적 가능한 Evidence가 있어야 한다.

Action Type:

- `required` — 반드시 해야 하는 일
- `optional` — 신청·선택
- `check` — 조건 확인 필요

---

## 5. AI Rules

- AI가 생성한 분류값은 사용자가 수정할 수 있어야 한다.
- **User Edited 값은 AI 재분석으로 덮어쓰지 않는다.**
- 기존 Topic과 유사하면 기존 Topic을 우선 재사용한다.
- 행동 요구가 없으면 Action을 생성하지 않는다.
- 근거 없는 날짜, 조건, 요구사항을 추측하지 않는다.
- 검색 답변은 가능한 경우 Source와 Evidence를 함께 제시한다.
- AI 챗봇 자체를 만드는 방향으로 UI나 기능을 확장하지 않는다.

---

## 6. Tech Stack

현재 확정 기술스택:

- Frontend: Next.js + TypeScript
- UI: Tailwind CSS + shadcn/ui
- Database: Supabase PostgreSQL
- Storage: Supabase Storage
- Vector Search: pgvector
- Authentication: Supabase Auth
- Google Auth: Google OAuth 2.0
- Google Integration: Gmail API / Drive API / Calendar API
- AI: Gemini API
- Embedding: Gemini Embedding
- Worker: Google Cloud Run
- Event: Google Cloud Pub/Sub / Webhook
- Deploy: Vercel

기존 기술스택을 임의로 교체하거나 중복 기술을 추가하지 않는다.

---

## 7. Development Order

개발은 다음 순서를 기준으로 진행한다.

1. Wireframe
2. DB Migration
3. API Specification
4. AI Structured Output
5. Implementation

현재 단계보다 뒤의 구조를 먼저 임의 확정하지 않는다.

예:
- DB 구조가 확정되기 전에 API 필드를 임의 확정하지 않는다.
- API와 AI Structured Output이 확정되기 전에 임시 데이터 구조를 제품 기준처럼 굳히지 않는다.

---

## 8. Main Screens

v1 기본 화면 구조:

- Home
- Library
- Search
- Actions
- Detail
- Settings / Connections

원칙:

- Gmail / Drive / Calendar별 독립 메인 화면을 만들지 않는다.
- Library는 Unified ITEM 중심으로 구성한다.
- Search는 챗봇 중심 UI가 아니라 검색 결과와 근거 확인 중심으로 구성한다.
- Detail에서는 원본과 AI 분석 결과, Action, Deadline, Evidence를 확인할 수 있어야 한다.

---

## 9. Data Policy

### 직접 업로드

- 원본 파일은 서비스 Storage에 저장한다.
- 추출 콘텐츠, AI Metadata, Search Index는 별도 관리한다.

### Google 데이터

- Gmail, Drive, Calendar의 원본은 Google에 유지한다.
- 서비스에는 검색·분류·Action 처리에 필요한 데이터만 저장한다.
- 서비스 데이터 삭제가 Google 원본 삭제로 이어지면 안 된다.

### Google 연결 해제

연결 해제 시:

- 신규 동기화 중단
- 기존 분석 데이터 유지
- 기존 검색 유지
- 기존 Action / D-Day 유지
- 재연결 시 동기화 재개

---

## 10. Implementation Rules

코드를 변경하기 전에:

1. 관련 요구사항을 `docs/SPEC.md`에서 확인한다.
2. 영향받는 파일과 기능을 파악한다.
3. 여러 파일을 수정하는 작업이면 구현 계획을 먼저 세운다.
4. 기존 구조를 최대한 유지하면서 필요한 최소 범위를 수정한다.

구현 시:

- TypeScript 타입을 명확하게 유지한다.
- 불필요한 `any` 사용을 피한다.
- Secret, API Key, Service Role Key를 코드나 Git에 커밋하지 않는다.
- 환경변수는 `.env.local` 또는 배포 환경의 Secret으로 관리한다.
- 데이터베이스 변경은 재현 가능한 Migration으로 관리한다.
- 기존 사용자 데이터에 영향을 주는 파괴적 변경을 임의로 수행하지 않는다.
- 사용자가 요청하지 않은 대규모 리팩터링을 함께 수행하지 않는다.
- 새 라이브러리를 추가하기 전에 기존 스택으로 해결 가능한지 확인한다.

---

## 11. Validation

작업 완료 전에 다음을 확인한다.

- 기존 Source of Truth와 충돌하지 않는가?
- Unified ITEM 원칙을 유지하는가?
- User Edited 값을 보호하는가?
- Action / Deadline에 충분한 Evidence가 있는가?
- Source 추적이 가능한가?
- v1 Scope를 벗어난 기능을 추가하지 않았는가?
- Secret 또는 민감정보가 코드에 포함되지 않았는가?
- 수정한 기능에 필요한 테스트 또는 검증을 수행했는가?

테스트 명령은 프로젝트에 실제로 존재하는 script와 설정을 사용한다.
존재하지 않는 명령이나 도구를 임의로 가정하지 않는다.

---

## 12. Documentation Rule

구현으로 인해 제품 동작이나 개발 기준이 변경되면 관련 문서도 함께 갱신한다.

단:

- 코드에 맞추기 위해 문서를 임의로 바꾸지 않는다.
- Source of Truth 변경이 필요한 경우 먼저 변경점을 명확히 제시한다.
- README에는 개요만 유지하고 상세 설계는 `docs/SPEC.md`에서 관리한다.
- 동일한 규칙을 여러 문서에 불필요하게 중복 작성하지 않는다.

---

## 13. Do Not

다음 작업은 명시적인 요구나 기준 변경 없이 수행하지 않는다.

- v1 Scope 밖의 기능 추가
- 새로운 기술스택 도입
- Gmail / Drive / Calendar별 별도 서비스 구조 생성
- AI 챗봇 중심 제품으로 변경
- 근거 없는 Deadline 생성
- User Edited 값 자동 덮어쓰기
- Google 원본 데이터 삭제
- 파일 실제 폴더 자동이동
- 자동 신청·제출·결제 기능 추가
- 네이티브 모바일 앱 개발
- 대규모 구조 변경 또는 불필요한 리팩터링

---

## 14. Working Principle

**먼저 기준을 확인하고, 가장 작은 단위로 구현하고, 검증한 뒤 다음 단계로 진행한다.**

모호한 부분은 추측해서 제품 규칙으로 만들지 않는다.
