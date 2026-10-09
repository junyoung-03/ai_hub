# docs/api/API_SPEC.md

# AI 통합 정보 허브 API 명세 v0.1

> 기준 문서: 「AI 통합 정보 허브 — 서비스 기획 및 개발 기준서 v0.5」  
> 개발 순서: Wireframe → DB Migration → API 명세 → AI Structured Output → 구현  
> 기술 스택: Next.js + TypeScript + Supabase + Google API + Gemini + Cloud Run

---

## 1. 목적

본 문서는 AI 통합 정보 허브 v1의 Application API와 Internal API를 정의한다.

v1의 핵심 범위는 다음 3가지다.

- COLLECT: Gmail · Google Drive · Google Calendar 자동수집 + PDF · 이미지 · 스크린샷 · 문서 · 텍스트 직접입력
- FIND: AI 자동분류 + 자연어 통합검색 + Source / Evidence
- ACT: Action 추출 + Deadline / D-Day 관리

v1에서 다음 기능은 제외한다.

- SMS · 카카오톡 자동수집
- 네이버메일 · Outlook 자동연동
- Google Drive 실제 폴더 자동이동
- 자동 신청 · 제출 · 결제
- 복잡한 Life Graph
- 네이티브 모바일 앱

---

## 2. API 기본 구조

### 2.1 Public Application API

```text
/api/v1/*
```

브라우저에서 호출하는 모든 업무 API는 Next.js Application API를 거친다.

```text
Browser
  ↓
Next.js Application API
  ↓
인증 / 권한 / 입력 검증
  ↓
Supabase / Google / Worker
```

### 2.2 Internal API

```text
/api/internal/v1/*
```

Cloud Run Worker, Pub/Sub, 서버 내부 작업에서만 사용한다.

브라우저에서 직접 호출할 수 없다.

---

## 3. 공통 보안 원칙

1. 클라이언트 요청에서 `user_id`를 받지 않는다.
2. `user_id`는 Supabase Auth 세션에서 서버가 확정한다.
3. Service Role / Secret Key는 브라우저에 노출하지 않는다.
4. Google OAuth Token은 브라우저에 노출하지 않는다.
5. Browser에서 DB의 SECURITY DEFINER RPC를 직접 호출하지 않는다.
6. 모든 변경 요청은 Application API를 통해 수행한다.
7. 타 사용자 리소스는 존재 여부를 노출하지 않고 `404` 또는 `403`으로 처리한다.
8. PostgreSQL 내부 오류와 Stack Trace를 사용자에게 직접 노출하지 않는다.

---

## 4. 공통 HTTP 규칙

| HTTP Status | 의미 |
|---|---|
| 200 | 정상 조회 / 수정 |
| 201 | 리소스 생성 |
| 202 | 비동기 작업 접수 |
| 204 | 정상 처리, 응답 본문 없음 |
| 400 | 요청 형식 오류 |
| 401 | 인증 필요 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 또는 접근 불가 |
| 409 | 중복 / 상태 충돌 |
| 422 | 업무 규칙 위반 |
| 429 | Rate Limit |
| 500 | 서버 내부 오류 |
| 503 | 외부 서비스 일시 장애 |

---

## 5. 공통 Error Response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "요청값이 올바르지 않습니다.",
    "details": {},
    "requestId": "uuid"
  }
}
```

### 5.1 기본 Error Code

```text
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
PROCESSING_FAILED
RATE_LIMITED
EXTERNAL_SERVICE_ERROR
INTERNAL_ERROR
```

---

# 6. CONNECTIONS / GOOGLE OAUTH

## 6.1 Google 연결 상태 조회

### GET `/api/v1/connections`

Response:

```json
{
  "google": {
    "status": "connected",
    "accountEmail": "user@example.com",
    "lastSyncedAt": "2026-10-03T10:00:00Z"
  }
}
```

---

## 6.2 Google OAuth 시작

### POST `/api/v1/connections/google/authorize`

Response:

```json
{
  "authorizationUrl": "https://accounts.google.com/..."
}
```

서버는 OAuth `state`를 생성하고 검증한다.

---

## 6.3 Google OAuth Callback

### GET `/api/v1/connections/google/callback`

처리 순서:

```text
Authorization Code 검증
→ 사용자 확인
→ Google Provider Account ID 확인
→ 기존 connection 검색
→ 기존 connection 재사용 또는 신규 생성
→ status = connected
→ Token 안전 저장
→ 최초 Sync 작업 등록
```

최초 동기화 전체를 Callback 요청 안에서 수행하지 않는다.

---

## 6.4 Google 연결 해제

### POST `/api/v1/connections/google/disconnect`

처리:

```text
신규 동기화 중단
기존 분석 데이터 유지
기존 검색 데이터 유지
기존 Action / D-Day 유지
Google 원본 데이터 유지
```

재연결 시 기존 Google Account Identity를 기준으로 기존 connection 재사용을 우선한다.

---

# 7. UPLOAD / 직접 입력

## 7.1 업로드 구조

파일 원본은 Next.js 서버를 통째로 경유하지 않는다.

```text
Browser
→ Upload Session 요청
→ Next.js
→ Signed Upload 정보 발급
→ Browser
→ Supabase Storage 직접 업로드
→ Complete API
→ ITEM 생성
→ AI Pipeline Queue
```

---

## 7.2 Upload Session 생성

### POST `/api/v1/uploads`

Request:

```json
{
  "fileName": "등록금안내.pdf",
  "mimeType": "application/pdf",
  "size": 2459103
}
```

Response:

```json
{
  "uploadId": "uuid",
  "storagePath": "user-id/uuid/original.pdf",
  "signedUploadUrl": "...",
  "expiresAt": "...",
  "completeBefore": "..."
}
```

`Idempotency-Key` UUID가 필수다. 서버 생성 upload UUID 및 사용자별 요청 fingerprint를 사용한다.
같은 key·동일 요청은 같은 session, 다른 요청은 409. Signed upload token은 2시간, 논리 complete 기한은 15분이다.
원본 filename은 표시용 title/session metadata에만 쓰며 경로에는 넣지 않는다. 완료 ITEM이 있으면
토큰을 새로 발급하지 않고 `{uploadId,itemId,state}`를 반환한다.

서버 검증:

- 허용 MIME Type
- 최대 파일 크기
- 파일명 정규화
- 사용자별 Storage Path
- Upload Session 유효기간

---

## 7.3 Upload 완료

### POST `/api/v1/uploads/{uploadId}/complete`

Response: `202 Accepted`

```json
{
  "item": {
    "id": "uuid",
    "source": "upload",
    "format": "pdf",
    "processingStatus": "queued"
  }
}
```

---

## 7.4 Text 직접입력

### POST `/api/v1/items/text`

Request:

```json
{
  "title": "학교 등록금 안내 메모",
  "text": "등록금 납부 기간은..."
}
```

처리:

```text
source = manual
format = text
processing_status = queued
```

Response: `202 Accepted`

---

# 8. ITEM / LIBRARY

## 8.1 ITEM 목록

### GET `/api/v1/items`

Query Parameters:

```text
source
format
topic
documentType
processingStatus
from
to
cursor
limit
```

예:

```text
GET /api/v1/items?source=gmail&topic=등록금&limit=30
```

기본 `limit = 30`.

Pagination은 Offset보다 Cursor 방식을 기본으로 한다.

Response:

```json
{
  "items": [
    {
      "id": "uuid",
      "source": "gmail",
      "format": "email",
      "title": "2026학년도 등록금 납부 안내",
      "processingStatus": "completed",
      "classification": {
        "primaryTopic": "등록금",
        "documentType": "billing",
        "tags": ["학교", "납부"],
        "origin": "ai"
      },
      "createdAt": "2026-10-03T10:00:00Z"
    }
  ],
  "nextCursor": "..."
}
```

---

## 8.2 ITEM 상세

### GET `/api/v1/items/{itemId}`

Response:

```json
{
  "item": {},
  "classification": {},
  "actions": [],
  "evidence": [],
  "processing": {},
  "original": {
    "url": "...",
    "previewType": "google"
  }
}
```

원본 접근:

- Google Data → Google Original URL
- Upload → 권한 검증 후 임시 접근 URL
- Manual Text → 서비스 내부 표시

---

## 8.3 실패 ITEM 재처리

### POST `/api/v1/items/{itemId}/retry`

허용 조건:

```text
processing_status = failed
```

Response:

```text
202 Accepted
```

이미 작업 중이면:

```text
409 Conflict
```

---

# 9. CLASSIFICATION OVERRIDE

## 9.1 사용자 분류 수정

### PATCH `/api/v1/items/{itemId}/classification`

Request 예:

```json
{
  "primaryTopic": "학비"
}
```

PATCH 의미:

| 입력 | 의미 |
|---|---|
| 필드 생략 | 기존 사용자 Override 유지 |
| `"primaryTopic": null` | Topic Override 해제 |
| `"documentType": null` | Document Type Override 해제 |
| `"tags": null` | Tags Override 해제 |
| `"tags": []` | 사용자가 Tag를 모두 제거 |

예:

```text
AI Topic = 등록금
User Topic = 학비
AI 재분석 = 수업료
Effective Topic = 학비
```

사용자가:

```json
{
  "primaryTopic": null
}
```

을 보내면:

```text
Effective Topic = 수업료
```

Application API는 PATCH 요청에 포함되지 않은 Override 값을 유지한다.

---

# 10. SEARCH

## 10.1 통합 검색

### POST `/api/v1/search`

Request:

```json
{
  "query": "이번 학기 학비 언제까지 내야 해?",
  "filters": {
    "source": [],
    "format": [],
    "topic": [],
    "from": null,
    "to": null
  },
  "limit": 20
}
```

검색 처리:

```text
Query 분석
→ Keyword Search
→ Vector Search
→ Metadata Search
→ 결과 병합 / Ranking
→ Top Relevant ITEM / Action
→ Gemini Answer
→ Answer + Source + Evidence
```

Response:

```json
{
  "status": "answered",
  "answer": "등록금 납부 마감일은 10월 31일입니다.",
  "sources": [
    {
      "itemId": "uuid",
      "title": "등록금 납부 안내",
      "source": "gmail"
    }
  ],
  "evidence": [
    {
      "itemId": "uuid",
      "text": "등록금 납부 기간은 10월 21일부터 10월 31일까지입니다."
    }
  ],
  "results": []
}
```

근거 부족:

```json
{
  "status": "insufficient_evidence",
  "answer": null,
  "message": "관련 자료에서 확정할 수 있는 정보를 찾지 못했습니다.",
  "sources": [],
  "evidence": []
}
```

검색 결과는 추측하지 않는다.

---

# 11. ACTIONS

## 11.1 Action 목록

### GET `/api/v1/actions`

Query:

```text
type=required|optional|check
status=open|completed
deadlineStatus=confirmed|needs_review|none
cursor
limit
```

UI 매핑:

| UI | DB |
|---|---|
| 해야 할 일 | required |
| 신청·선택 | optional |
| 확인 필요 | check |

---

## 11.2 Action 상세

### GET `/api/v1/actions/{actionId}`

Response:

```json
{
  "action": {},
  "sources": [
    {
      "itemId": "uuid",
      "evidenceText": "...",
      "isCurrent": true,
      "observedDeadlineDate": "2026-10-31"
    }
  ]
}
```

Action은 최소 1개의 current Evidence를 유지한다.

---

## 11.3 Action 완료 상태 변경

### PATCH `/api/v1/actions/{actionId}/status`

Request:

```json
{
  "status": "completed"
}
```

규칙:

```text
completed → completed_at = now()
open → completed_at = null
```

v1에서는 다음 사용자 수정 API를 제공하지 않는다.

- Action 제목 직접 변경
- Deadline 직접 변경
- Evidence 직접 변경

---

# 12. DATA MANAGEMENT

## 12.1 직접 업로드 ITEM 삭제

### DELETE `/api/v1/data/uploads/{itemId}`

삭제 대상:

```text
Storage 원본
ITEM
Classification
Search Chunk
관련 Action Evidence
```

Action의 마지막 current Evidence인 경우 DB 무결성 규칙을 위반하지 않도록 Application API에서 의존성을 먼저 처리한다.

---

## 12.2 Google 분석 데이터 삭제

### DELETE `/api/v1/data/google-analysis`

삭제 대상:

```text
Google Source ITEM
Classification
Search Chunk
Action / Evidence
서비스 분석 데이터
```

삭제하지 않는 것:

```text
Gmail 원본
Google Drive 원본
Google Calendar 원본
```

---

## 12.3 서비스 전체 데이터 삭제

### DELETE `/api/v1/data/all`

Request 예:

```json
{
  "confirmation": "DELETE_ALL_MY_DATA"
}
```

서비스 전체 삭제는 재인증 또는 추가 확인 절차를 둔다.

구체 방식은 Auth 구현 단계에서 확정한다.

---

# 13. INTERNAL API

## 13.1 Google Sync 요청

### POST `/api/internal/v1/sync/google`

Request:

```json
{
  "connectionId": "uuid",
  "source": "gmail",
  "mode": "incremental"
}
```

브라우저 호출 금지.

---

### Implementation Phase 5 — POST `/api/v1/connections/google/sync`

사용자 수동 초기 수집용 endpoint이며 위 internal incremental sync와 분리한다.
Cookie 인증과 서버 `requireUser()`가 필요하고 same-origin POST만 허용한다.
Request body, user_id, connection_id, query, limit을 클라이언트에서 받지 않는다.
현재 로그인 사용자의 connected Google Connection만 사용한다.

- 고정 Gmail query: `in:inbox newer_than:30d`, 최대 100개의 고유 message ID.
- messages.list 및 messages.get(full)만으로 본문과 첨부 metadata를 읽는다. attachments.get / attachment binary decoding / AI 실행은 하지 않는다.
- 신규 ITEM은 source=gmail, format=email, external_id=messageId, external_container_id=NULL, metadata.threadId=threadId, processing_status=queued.
- 기존 ITEM 재수집은 원문 필드만 갱신하며 classification / Action / processing_status를 변경하지 않는다. 기존 user+connection+message unique index와 충돌 시 재조회로 중복을 막는다.
- Token 조회/복호화/Google refresh/RPC 저장은 server-only 경계에 한정한다.
- 응답은 `collected_count`, `created_count`, `updated_count`, `skipped_count`, `failed_count`, `complete`, `capped`, `query`, `max_messages`다. collected_count는 성공적으로 생성/갱신/재사용한 수의 합이다.
- 개별 get/파싱/저장 실패는 failed_count로 보고한다. 실패가 있으면 성공한 ITEM을 보존하고 완료 기준점과 last_synced_at은 갱신하지 않는다.
- 전체 성공 시 list 이전 profile historyId를 initial_collection 기준점으로 기록한다. capped는 목록의 다음 페이지 존재 여부이며 mailbox 전체 동기화 완료나 incremental cursor를 의미하지 않는다.
- 연결 없음/disconnected/Token 없음/이미 수집 중은 409, refresh 실패는 401, Gmail/저장 오류는 502다. 내부 오류 원문이나 credential은 반환하지 않는다.

Library/Detail GET 응답의 item에 `sourceCreatedAt`을 추가한다. Detail의 `gmail`은 Gmail ITEM일 때만 from/to/cc/bcc/dateHeader whitelist를 반환하며 기타 ITEM은 NULL이다. 메일 본문은 contentText plain text로 표시하고 raw metadata를 통째로 반환하지 않는다. 기존 createdAt 정렬/날짜 필터 기준은 유지한다.

---

## 13.2 ITEM 처리

### POST `/api/internal/v1/process/items/{itemId}`

상태 흐름:

```text
uploaded
→ queued
→ extracting
→ analyzing
→ indexing
→ completed
```

실패:

```text
failed
+ processing_error
```

---

# 14. AI 처리 Pipeline

Worker 처리 순서:

```text
1. ITEM 조회
2. Source별 원문 추출
3. content_hash 중복 확인
4. AI Structured Output 분석
5. Classification 저장
6. Action / Evidence Transaction
7. Search Chunk 생성
8. Embedding 생성
9. completed 처리
```

AI Structured Output 상세 Schema는 별도 문서에서 정의한다.

---

# 15. ACTION / EVIDENCE TRANSACTION 규칙

Action과 Evidence 변경은 동일 transaction에서 처리한다.

PostgreSQL 오류:

```text
40001 serialization_failure
40P01 deadlock_detected
```

발생 시:

```text
전체 transaction을 처음부터 재시도
```

중간 SQL 한 문장만 재실행하지 않는다.

자동 재시도 금지:

```text
23503 foreign_key_violation
23514 check_violation
권한 오류
업무 Validation 오류
```

---

# 16. GOOGLE 변경 이벤트

Google Push / PubSub Event 자체를 원본 데이터로 신뢰하지 않는다.

```text
Google 변경 알림
→ Webhook / PubSub
→ 이벤트 검증
→ Connection 식별
→ 실제 Google API 재조회
→ ITEM Upsert
→ 분석 Pipeline
```

Push Event는 “변경이 발생했다”는 신호로만 사용한다.

---

# 17. API 금지 범위

v1에서는 다음 API를 만들지 않는다.

```text
/send-email
/submit-application
/pay
/move-google-drive-file
/delete-google-original
/send-kakao
/sms-sync
```

---

# 18. SECURITY DEFINER 처리방향

현재 DB:

```text
public.set_classification_override()
SECURITY DEFINER
authenticated EXECUTE
```

현재는 함수 내부에서 `auth.uid()` 및 ITEM 소유권을 검사한다.

API 구현 시 최종 구조:

```text
Browser
→ PATCH /api/v1/items/{itemId}/classification
→ Next.js
→ DB
```

API 구현 완료 후 후속 Migration에서:

```text
authenticated
→ public.set_classification_override 직접 EXECUTE 제거
```

를 적용한다.

---

# 19. Public API 요약

```text
GET    /api/v1/connections
POST   /api/v1/connections/google/authorize
GET    /api/v1/connections/google/callback
POST   /api/v1/connections/google/disconnect

POST   /api/v1/uploads
POST   /api/v1/uploads/{uploadId}/complete

GET    /api/v1/items
POST   /api/v1/items/text
GET    /api/v1/items/{itemId}
POST   /api/v1/items/{itemId}/retry
PATCH  /api/v1/items/{itemId}/classification

POST   /api/v1/search

GET    /api/v1/actions
GET    /api/v1/actions/{actionId}
PATCH  /api/v1/actions/{actionId}/status

DELETE /api/v1/data/uploads/{itemId}
DELETE /api/v1/data/google-analysis
DELETE /api/v1/data/all
```

---

# 20. Internal API 요약

```text
POST /api/internal/v1/sync/google
POST /api/internal/v1/process/items/{itemId}
```

---

# 21. 구현 전 남은 결정사항

다음 항목은 후속 단계에서 확정한다.

1. Google OAuth Scope 최종 목록
2. Google Token 암호화 및 저장 위치
3. Worker 인증 방식
4. Internal API 인증 방식
5. Upload 최대 파일 크기
6. 지원 MIME Type
7. Search Ranking 가중치
8. Gemini Embedding 모델 및 dimension
9. Vector Index 방식
10. Search Chunk 크기
11. Retry 횟수 / Backoff
12. 전체 데이터 삭제 시 재인증 방식
13. API Rate Limit 정책

---

# 22. 개발 단계 상태

## Phase 6A — Gmail ITEM 분석 실행

`POST /api/v1/items/{itemId}/analyze`는 현재 로그인 사용자의 저장된 Gmail/email ITEM만 분석한다.
동일 origin 요청만 허용한다. 클라이언트에서 user_id, 모델 또는 credential을 받지 않는다.
동일 본문·모델·schemaVersion의 검증된 결과는 재사용한다. 새 출력은 전체 schema와 원문 Evidence
검증을 통과한 뒤 서버 전용 RPC로 Classification + Action + Evidence + ITEM metadata를 원자 저장한다.
응답 필드: `created_count`, `reused_count`, `action_count`, `cached`, `processing_status`.
완료 상태는 `indexing`이며 검색/Embedding 완료를 의미하지 않는다.
오류: 401 인증 필요, 403 origin 불일치, 404 소유 ITEM 없음, 409 분석 중/경합,
422 입력·출력 검증 실패, 503 Gemini/저장 서비스 오류. 원문·Token·provider 오류 상세를 반환하지 않는다.
Action 의미 병합이 불명확하거나 기존 후보가 사라지는 재분석은 자동 삭제/증식 대신 저장을 거부한다.

```text
✅ Wireframe
✅ DB Migration
✅ DB Optimization
✅ API 명세 v0.1

→ AI Structured Output
⬜ 실제 구현
```

## 23. Phase 6B — ITEM Detail 조회 계약

사용자 승인 범위: Phase 6A 저장 결과를 기존 ITEM 조회 API에 연결한다. UI/UX 설계,
새 화면/컴포넌트 설계, DB Schema/Migration 변경, Gemini 호출은 포함하지 않는다.
6B-1에서 아래 계약과 TypeScript 타입을 확정하고 6B-2에서 기존 GET 조회에 연결했다.
**Phase 6B COMPLETE — 6B-3 통합 검증 및 인계 완료 (2026-10-04).**

대상: `GET /api/v1/items/{itemId}`. TypeScript 기준: `src/types/items.ts`의 `ItemDetailResponse`.
기존 `GET /api/v1/items`의 목록 계약/필터/정렬/Pagination은 변경하지 않는다.
모든 신규 응답 필드는 6B-2 연결 후 항상 존재하며, 없는 단일 값은 null, 목록은 빈 배열이다.

| 필드 | 타입 / 의미 |
| --- | --- |
| `item` | 기존 id/title/source/format/processingStatus/createdAt/updatedAt/contentText/sourceCreatedAt 유지 |
| `classification` | 기존 EffectiveClassification 유지. `effectiveClassification`과 값이 동일한 호환 필드 |
| `aiClassification` | Classification row의 ai_* 값: primaryTopic/documentType/tags. row가 없으면 null |
| `userClassification` | user_* override: primaryTopic/documentType/tags. override가 모두 null이면 객체도 null |
| `effectiveClassification` | 기존 effectiveClassification() 결과: primaryTopic/documentType/tags/origin/available/origins |
| `actions` | 기존 Action 필드에 requirements/conditions/startDate/startAt/completedAt 추가 |
| `evidence` | 기존 flat Evidence 배열 유지. 각 row는 ActionSource이며 actionId로 Action과 연결 |
| `eventObservations` | items.metadata.aiAnalysis.result.eventObservations의 검증된 행사/일정 관찰값 |
| `aiAnalysis` | 저장된 유효 v0.2 분석의 schemaVersion/analyzedAt만 반환. 없거나 검증 불가하면 null |
| `processing` | 기존 status 유지. item.processingStatus와 같은 DB processing_status 값 |
| `gmail`, `original` | 기존 whitelist header와 안전한 원본 URL / previewType 계약 유지 |

### 분류 최종값

각 필드에서 non-null user override > AI 값을 적용한다. user 필드의 null은 override 없음이며,
user tags의 []는 명시적 전체 제거이므로 AI tags로 되돌리지 않는다. 분류 row가 없으면
aiClassification/userClassification은 null, EffectiveClassification은 기존 unavailable 표현을 유지한다.
부분 override 객체는 수정하지 않은 필드를 null로 보존한다. aiClassification의 tags는 배열이다.
AI metadata의 후보 classification으로 DB classification이나 사용자 값을 대체하지 않는다.
GET은 읽기만 수행하며 user_* 및 기존 분석 저장/재분석 보호 로직을 변경하지 않는다.

### Action / Deadline / EventObservation

Action은 기존 actions row만 반환하며 AI 후보에서 생성하지 않는다. 기존 필드
id/title/type/status/deadlineStatus/deadlineDate/deadlineAt/deadlineSourceId를 유지한다.
requirements/conditions는 string[], startDate/startAt/completedAt은 DB 값 또는 null이다.
날짜는 YYYY-MM-DD, 시각은 저장된 timezone 포함 timestamp로 반환하며 새 날짜나 시간대를 추론하지 않는다.
deadlineStatus=needs_review는 마감일 확인 필요, none은 마감 정보 없음이다.
행사 관찰값을 deadline/startDate/Action으로 승격하지 않는다. completedAt은 기존 완료 상태 기록이다.

EventObservation은 기존 v0.2 DateObservation의 제한된 타입을 재사용한다:
confirmed이면 date:string, datetime:string|null; needs_review이면 date/datetime 모두 null.
rawText:string과 원문 AnalysisEvidence가 필수이며 status=none은 행사 배열에 허용하지 않는다.
유효한 분석 또는 행사 관찰값이 없으면 eventObservations=[]다. aiAnalysis=null과 유효 분석의 빈 배열은
구분할 수 있다. 분석/행사 데이터는 현재 ITEM 원문과 저장된 검증 규칙에 맞는 경우만 반환한다.
조회에서 모델 설정이나 credential을 요구하거나 Gemini를 호출하지 않는다.
indexing을 completed로 변경하지 않는다.

### Evidence / 보안 / 호환성

evidence의 기존 id/actionId/itemId/text/locator/isCurrent/observedAt을 유지하고,
observedDeadlineDate/observedDeadlineAt을 추가한다. 동일 Action의 다른 소유 ITEM 근거와 history도 유지한다.
Action은 id당 1개, Evidence는 source id당 1개를 반환하며 history를 합치거나 지우지 않는다.
각 Source의 원문에 있는 근거만 반환하고 확인되지 않는 AI 추론을 인용으로 만들지 않는다.

locator는 kind/page/section/startChar/endChar/field 및 검증된 schemaVersion/evidence/
startObservation/deadlineObservation만 허용한다. 내부 analysisKey 및 임의 JSON key는 제거한다.
전체 인용은 locator.evidence에서, 시작/마감 관찰 근거는 해당 observation.evidence에서 확인한다.
이 확장값이 없는 기존 locator도 지원하며 기존 허용 위치 필드는 보존한다.
허용 목록 밖의 locator key에 의존하는 클라이언트에는 의도적인 보안 제한이 적용된다.
raw items.metadata, 전체 aiAnalysis.result, model, inputFingerprint, Token, storage 경로,
DB 내부 오류를 응답에 추가하지 않는다. 기존 권한 내 원문/메일 header 조회는 유지한다.

requireUser(), 서버 세션 client, 모든 조회의 사용자 소유권 제한과 기존 RLS를 유지한다.
다른 사용자 Source의 존재/원문은 노출하지 않는다. 인증/404/오류 및 private no-store 계약은 유지한다.
신규 필드는 additive이며 기존 필드명과 의미는 유지한다. 별도 action_sources 응답 중복 배열은 만들지 않는다.

### 6B-3 검증 결과 및 범위 (2026-10-04)

- ai-hub-dev 저장 Gmail 46건: v0.2 분석 2건, Action 연결 ITEM 1건, 분석된 no-action ITEM 1건,
  분석 metadata 없는 ITEM 44건. 서로 다른 실제 ITEM 3건으로 네 가지 요청 사례를 검증했다.
- 실제 authenticated SQL principal로 RLS가 적용된 SELECT snapshot을 읽고, 기존 production
  getItemDetail 및 GET handler를 read-only transport/auth adapter로 실행했다. Classification,
  Action 1건, Evidence 1건, 기존 필드와 신규 필드, 원문 근거 및 중복 없음을 검증했다.
  실제 Browser cookie 세션의 authenticated HTTP E2E를 재실행한 것으로 해석하지 않는다.
- 해당 4개 핵심 테이블의 RLS enabled 확인. 타 실제 계정은 없어 별도 synthetic authenticated sub로
  같은 실제 DB에서 소유 데이터 0건 및 handler 404를 확인했다. 사용자/세션 행을 만들지 않았다.
  anon DB SELECT는 테이블 권한으로 거부됐다. 로컬 production HTTP의 미인증 ITEM 목록/Detail/
  connections 요청은 401, Library는 로그인으로 redirect됐다. Detail 경로의 session client와
  requireUser/소유권 필터 유지 및 admin/service_role client 미사용을 확인했다.
- 실제 override 0건, eventObservations 0건. override/빈 tags/event-only/needs_review/시작일과
  마감일 분리/malformed 분석 metadata는 기존 합성·격리 검증 PASS로 구분한다.
  실제 event-date 적격 Gmail 샘플 없음이라는 Phase 6A 회귀 TODO를 유지한다.
- 실제 Action의 deadline은 none/null이며 그대로 반환했다. 확정 마감일·시작일 매핑은 합성 검증 PASS다.
- 원문·raw metadata·credential은 보고서에 기록하지 않았다. 실제 응답의 허용 key 및 로컬 Secret
  값 비노출 검사 PASS, browser static 파일 17개에서 Secret 실제 값 일치 0건.
- 검증 전후 소유 ITEM/Classification/Action/Source/Connection 조회 snapshot 동일.
  DB 데이터·Schema·RLS·Migration/history 변경 없음, Gemini/Google 재수집 호출 없음.
- npm test 52개, typecheck, lint, build, check:supabase, git diff --check 모두 PASS.
  Auth 연결 검사의 최초 EACCES는 로컬 sandbox 네트워크 차단이며, 네트워크 허용 실행에서 PASS했다.
  Google OAuth/세션 갱신/Logout/Re-login은 기존 mock 회귀 검증을 사용했으며 실제 OAuth를 재실행하지 않았다.

## 24. Drive-3 Data OAuth / Token 경계 (2026-10-05)

서비스 로그인 OAuth와 별도인 기존 Data OAuth 경로를 확장한다.
POST /api/v1/connections/google/authorize: same-origin/Cookie 인증 필수.
body 없음은 기존 Google 메일 동작. 정확히 {"purpose":"drive_scope_upgrade"}만 추가 허용하며 user_id/connection_id/임의 scopes를 받지 않는다.
Drive 목적은 기존 connected 계정 필수(없으면 409). response는 기존 authorizationUrl만 반환하고 private no-store.
초기 Gmail Scope는 기존 openid/email/profile/gmail.readonly이며 Drive 목적은 drive.metadata.readonly/documents.readonly 추가.
이미 Drive 권한을 얻은 계정의 일반 재연결도 기존 데이터 권한을 요청한다. include_granted_scopes=true/access_type=offline.

Callback 목적은 query가 아니라 HMAC cookie의 소유자/연결/Google 계정/연결 수정시각/10분 만료와 결합한다.
실제 granted scopes 검증: Gmail 필수, Drive 목적에서는 두 신규 권한 필수, 허용 목록 외 권한 거부, 기존 데이터 권한 축소 거부.
다른 계정/부분 승인/거절/실패/disconnect·연결 변경은 기존 정상 bundle을 덮어쓰지 않는다.
신규 Refresh Token이 없으면 기존 Token으로 refresh하여 확장 권한·계정을 확인한 후 저장한다.
새 Refresh Token이 있어도 offline 권한을 검증한다. 검증에 Scope 응답이 없으면 실패한다.
Scope 확대 성공은 /settings?connection=drive_connected로 이동하며 파일 수집을 실행하지 않는다.
이전 cookie 형식의 진행 중 인증은 거부하고 재시작한다. Token/provider raw error는 응답하지 않는다.
계정/연결 식별자는 목적 검증용 HttpOnly 서명 cookie에만 결합하며 공개 JSON/redirect에는 추가하지 않는다.

upsert_google_connection의 기존 signature는 유지하며 허용 Scope 두 개 추가/상한 8개/기존 데이터 권한 축소 방지를 적용하는 Migration 초안을 작성했다.
upgrade_google_connection_scopes는 연결·Token snapshot을 비교하고 동일 계정 connected 상태에서만 저장하는 service_role 전용 RPC다.
Gmail history_id/initial_collection을 포함한 sync_state 및 last_synced_at/connected_at을 원자 보존한다.
refresh_google_connection_tokens_guarded는 connection→token lock과 기존 access ciphertext CAS로 오래된 refresh 덮어쓰기를 거부한다.
기존 내부 refresh RPC는 유지하되 서버 호출은 guarded 경로를 사용한다. 함수 미적용 상태에서 해당 코드를 배포/실연결 실행하지 않는다.
Scope SQL은 2026-10-05 ai-hub-dev 적용/history 등록 및 함수·권한·합성 보존/CAS/거절 검증 PASS.
실제 Google 추가 동의 성공 및 다중 세션 동시성 검증과 구분한다. persist_drive_item은 별도 승인 후 ai-hub-dev 적용 및 합성 Runtime PASS다.

drive.metadata.readonly는 Restricted, documents.readonly는 Sensitive. Google 동의 화면 Scope 등록 및 검증 영향은
상용화 전 TODO로 유지하며 이번 작업에서 Console 설정을 변경하지 않는다. drive.file/Picker는 제외.
Drive-3 endpoint POST /api/v1/connections/google/drive/collect: 구현·격리 검증 완료. 사용자 지정 Docs 1건으로 실제 collector/Google API/RPC/조회/reuse/RLS 검증 PASS. CLI auth/cookie adapter는 대체했으며 Browser 인증 HTTP E2E 재실행을 뜻하지 않는다. Drive 단계 COMPLETE 후 정지.
입력은 folder mode 또는 files mode 중 하나, 응답은 파일별 결과 및 created/updated/reused/excluded/failed/unprocessed,
complete/capped/stopReason/pagesRead/downloadedTextBytes/requestId. 본문/Token/raw error는 응답 금지.
persist_drive_item canonical Migration은 supabase/migrations/20261005013202_persist_drive_item.sql이다. 별도 승인 후 dev 적용/history 등록 및 소유권/권한/identity/CAS/분석 보존/RLS/disconnect Runtime PASS.
tests/fixtures/sql/drive/persist_drive_item.sql은 승인 초안 보관본이다. 지정 Docs 1건의 실제 저장/동일 버전 reuse/조회/원본 URL/사용자 RLS/Gmail 데이터 보존 PASS. 추가 수집 없이 정지한다.

입력: {"mode":"folder","folderId":"Google fileId"} 또는 {"mode":"files","fileIds":["Google fileId"]}.
추가 필드/임의 q/recursive/user_id/connection_id 금지. files는 1~20개 중복 없는 ID만 허용.
파일별 결과: fileId/outcome 및 성공 시 itemId, 실패·제외 시 안전한 code. 제목/본문/raw error 제외.
수집 제한은 SPEC 35절. full-document byte 예약으로 병렬 읽기의 quota 초과를 방지하며 잔여 quota가 400,000 bytes 미만이면 보수적으로 중단할 수 있다.
downloadedTextBytes는 크기 검증을 통과한 지원 본문 UTF-8 합계이며 저장 실패/SOURCE_CHANGED도 포함한다. Google JSON 전송량은 포함하지 않는다.
본문 요청 후 크기 초과·추출/다운로드 실패는 정확한 본문 크기를 알 수 없으므로 내부 quota에 400,000 bytes 예약을 그대로 차감한다.
따라서 실패 문서를 반복 읽어 quota를 우회하지 않으며, 이 보수적 차감량을 downloadedTextBytes의 실제 추출량으로 표시하지 않는다.
JSON 응답은 8 MB transport guard를 적용하고 넘으면 DOCUMENT_LIMIT로 저장 차단한다. 본문을 잘라 저장하지 않는다.
실행 중 120초 cooperative deadline, route maxDuration=150초(auth/응답 여유). 실제 배포 플랜/Fluid 설정은 배포 전 확인한다.

## 25. Calendar-2 — 승인된 수집 / Detail 계약 (2026-10-05)

Calendar-1 승인에 따라 구현한 계약이다. Calendar-2는 실제 Google 동의·Event 수집·개발 DB Migration 적용을 수행하지 않는다.
제품 범위/수집 제한/날짜 의미는 docs/SPEC.md 36절을 따른다. Calendar-3는 별도 승인 후 실제 검증한다.

### Data OAuth

기존 `POST /api/v1/connections/google/authorize`에 `{"purpose":"calendar_scope_upgrade"}`를 추가한다.
body의 추가 필드·임의 Scope·credential은 거절한다. 기존 connect/drive_scope_upgrade 및 서비스 로그인은 유지한다.
calendar.events.owned.readonly를 추가하고 기존 granted Gmail/Drive/Docs/Calendar 권한을 보존한다.
동일 Google sub/서명 state의 연결 수정시각/실제 scope/refresh 가능성을 검증하여 전용 upgrade RPC로 원자 저장한다.
callback 성공 redirect는 `/settings?connection=calendar_connected`이다. 새 UI/컴포넌트는 추가하지 않는다.
다른 계정/부분 동의/축소/거절/stale 상태/refresh 또는 저장 실패는 기존 저장 bundle과 checkpoint를 변경하지 않는다.
일반 connect 및 기존 Drive upgrade도 이전 Calendar 권한을 요청·검증하여 축소를 차단한다.

### POST /api/v1/connections/google/calendar/collect

인증된 현재 사용자, 같은 origin, 활성 단일 Google Data 연결만 허용한다. body는 없음 또는 빈 객체 `{}`만 허용한다.
body 상한 64 bytes. userId/calendarId/timeMin/timeMax/query/scope/credential 등 어떤 추가 필드도 허용하지 않는다.
서버가 primary/고정 기간/필터/페이지 정책을 정한다. 자동 AI/Action/Deadline/Classifications 생성은 없다.

응답은 기존 connectionResponse envelope/cache 정책을 사용하며 다음 count/상태만 반환한다:
created/updated/reused/skipped/failed/unprocessed:number, complete/capped:boolean,
stopReason:EVENT_LIMIT|PAGE_LIMIT|RUN_BYTES_LIMIT|RUN_TIMEOUT|LIST_FAILED|null, pagesRead:number, requestId:string.
Event ID/ITEM ID/제목/본문/raw provider response/metadata/token/secret는 수집 응답에 포함하지 않는다.
skipped는 처음 보는 취소·제외 유형/master·동일 실행 중복을 포함한다. failed는 validation/순서 불명확/CAS/개별 조회/저장 실패를 포함한다.
unprocessed는 이미 조회한 페이지에서 실행 timeout/텍스트 상한으로 처리하지 못한 개수다. 아직 조회하지 않은 Event 수를 추정하지 않는다.
complete=true는 고정 기간 내 이번 페이지 조회 및 처리 완료이며 전체 Calendar 동기화 완료를 의미하지 않는다.
빈 페이지도 nextPageToken이 있으면 다음 페이지로 진행한다. 목록 실패 후 이전에 저장한 ITEM을 rollback하지 않고 부분 결과를 반환한다.
정상 동일 버전 reuse도 서버 저장 RPC로 active connection/권한을 확인하지만 DB UPDATE는 하지 않는다.

오류: 401 세션/refresh 실패, 403 origin 불일치, 400 입력 오류, 409 연결/Calendar 추가 동의 필요,
502 Google/초기 client 실패, 500 내부 오류. 내부 raw error/credential은 반환하지 않는다.
신규 함수 Migration이 원격에 아직 없어 저장할 수 없는 상태는 성공으로 표시하지 않는다.

### GET /api/v1/items/{itemId}

기존 계약을 유지하며 `calendar: CalendarDetail|null`을 추가한다. Calendar source의 검증된 metadata에만 객체를 반환한다.
다른 Source 또는 invalid/missing metadata는 null이다. 기존 session client/user ownership/RLS 읽기 경계를 유지한다.

CalendarDetail의 허용 필드:
status:confirmed|tentative|cancelled, eventType:default,
start/end: `{date:YYYY-MM-DD,timeZone?:string}` 또는 `{dateTime:RFC3339,timeZone?:string}` 또는 null,
allDay:boolean|null, eventTimezone:string|null, calendarTimezone:string,
endTimeUnspecified:boolean, location:string, recurringEventId:string|null, originalStartTime:CalendarDate|null.
중첩 date도 whitelist로 재구성한다. raw metadata 전체, credentials, etag, 기타 미승인 중첩 필드는 반환하지 않는다.
all-day의 배타적 end date와 원본 offset/timezone을 보존한다. 취소된 ITEM의 보존 날짜는 마지막 정상 원본 값이며 현재 확정 예정일을 의미하지 않는다.
calendar는 AI eventObservations와 별개이고 GET에서 Action/Deadline/AI 분석을 생성하지 않는다.

### 저장 RPC / 적용 전 조건

`upgrade_google_calendar_scopes`와 `persist_calendar_item`은 service_role 전용 SECURITY DEFINER/빈 search_path 함수다.
Scope Migration은 기존 upsert allowlist/축소 방지/상한만 확장하며 새 Calendar upgrade로 전체 sync_state/connected_at/last_synced_at을 보존한다.
저장 Migration은 새 Calendar 함수만 포함한다. 기존 table/column/index/RLS와 기존 Migration을 수정하지 않는다.
함수 입력·owner/연결/Scope/Token·Calendar identity·hash/날짜/허용 metadata·CAS/버전 순서를 서버와 DB에서 검증한다.
권한 및 SQL 구문/격리 검증 결과는 PROJECT_STATE에 기록한다. 실제 개발 DB 실행/RLS/동시성 검증을 대체하지 않는다.
Calendar-3 승인 후 두 함수 Migration은 ai-hub-dev에 적용했다. 실제 RPC/RLS 및 OAuth/Event 1건/조회/회귀 결과와
CLI adapter·Browser collect HTTP의 실제 검증은 격리 테스트와 구분한다. API 계약 변경은 없다.


# 24. 승인된 Upload-1/2/3 서버 계약 (2026-10-05)

세 단계만 사용한다: Upload-1 기준 COMPLETE → Upload-2 구현 → Upload-3 실제 PDF/이미지 E2E 및 최종 회귀.
이 절은 사용자가 승인한 직접 업로드 정책을 구체화한다. 새 UI/UX·직접 Text 입력은 이번 범위가 아니다.

- `POST /api/v1/uploads`: 정확히 `{fileName,mimeType,size}` 1파일, UUID Idempotency-Key, 201.
  같은 origin/로그인 사용자 필수. owner/path/status/hash 클라이언트 지정 금지.
- `POST /api/v1/uploads/{uploadId}/prepare`: 빈 body 또는 `{}`만 허용(64B), 202.
  owner/session 확인 → reserve → private 원본 download/size/signature/decode/구조 검증/SHA256 → pending/dedupe.
  OCR 없는 text PDF는 서버 embedded 결과로 완료하며 기존 완료 응답을 반환한다.
  OCR 필요 시 lease release 후 `{uploadId,itemId,state:stored,mime,pages:[{page,method}],downloadUrl}`.
  downloadUrl은 본인 검증된 ITEM의 60초 signed original이며 DB/로그/localStorage에 저장하지 않는다.
  embedded text/raw hash/raster payload는 prepare 응답에 포함하지 않는다.
- `POST /api/v1/uploads/{uploadId}/complete`: 정확히 `{pages:[{page,text,provider,providerVersion,execution,language,confidence}]}`.
  현재 allowlist는 tesseract.js/7.0.0/client/kor+eng. confidence=null 또는 유한한 0~1 참고값.
  origin/JSON 실제 byte 상한 2,500,000B, 합계 100,000CP/400,000UTF8B. malformed/control/빈 OCR/추가 필드 차단.
  required OCR page 집합과 제출 page 집합 일치(누락/중복/추가/embedded 제출 금지).
  서버는 원본/plan/hash를 재검증하고 normalize/NFC/range/hash를 재계산한 뒤 새 attempt/CAS로 저장한다.
  입력 검증 실패는 claim 전에 거절/lease release; 유효 결과 저장 실패는 matching attempt 실패 경로 사용. 202.
  기존 `item:{id,source,format,processingStatus}`와 `itemId,outcome:created|reused,state`를 반환한다.
  처리는 동기 완료이며 마지막 queued는 AI 분석 대기다. 완료 응답 유실 후 재시도는 ITEM을 재사용한다.
- `GET /api/v1/items/{itemId}/original`: 본인 upload ITEM/검증된 canonical path를 cookie RLS로 조회한 뒤
  `{downloadUrl,expiresAt}` 60초 signed URL, private no-store. original_url은 계속 NULL이다.
- 상태는 기존 Detail GET: `upload:{version,extractionStatus,pages,error}` nullable whitelist만 추가.
  pages는 `{page,start,end,method,provider,providerVersion,execution,language,extractionVersion,confidence}`;
  PDF page 1-based/최종 text code point 0-based end-exclusive.
  이미지 1page 전체 OCR 범위. raw hash/path/session/raw OCR/credential은 Detail에 노출하지 않는다.

지원 MIME는 application/pdf, image/png, image/jpeg이며 extension+MIME+signature+실제 parser/decoder 모두 일치해야 한다.
5,000,000B/10PDF pages/20MP/side10,000px/서버1파일 동시처리/100,000CP/400,000UTF8B/서버 요청 전체120초.
브라우저 OCR은 단일 Worker/페이지 순차 처리이며 초기화 각 단계 및 페이지 job timeout 120초, cancel 시 즉시 terminate.
text PDF는 서버 PDF.js embedded 우선, text 없는 스캔 page만 browser render + Tesseract.js, mixed는 페이지별 처리한다.
confidence threshold 삭제 없음. 암호화/손상 자동복구/active content/embedded files/외부 resource 접근 금지.
교차 참조 스트림 및 같은 page의 text+raster/불확실 text 순서는 PDF_LAYOUT_NEEDS_REVIEW;
incremental/hybrid references는 안전 검토 전 거부한다. 이 보수적 parser 제한은 정상 결과의 일부 누락을 방지한다.

비공개 upload-originals의 `{userId}/{uploadUuid}/original.{pdf|png|jpg}` 경로만 사용하고 overwrite/public URL 없음.
source=upload, format=pdf|image, connection/container/originalURL=NULL, external_id=upload UUID.
사용자별 원본 bytes SHA256 dedupe, 추출 content_text SHA256은 별도 content_hash.
세션→signed upload→Storage→실제 검증→pending ITEM→추출/OCR→원자 finish.
Storage I/O 중 DB transaction 없음. global reservation은 서버 요청 동안만 유지하고 browser OCR 대기에는 lease가 없다.
attempt/lease/ITEM timestamp CAS는 stale finish 차단. 만료 running은 snapshot 일치 시만 실패 복구하고 새 attempt를 획득한다.
extraction/저장 실패는 부분 text 없이 failed; 조작/누락 입력은 claim 전 거절해 재시도 가능 상태를 보존한다.
탭 종료/브라우저 OCR 실패는 서버의 즉시 failed 판정이 아니다. owner session 재prepare 후 OCR 전체 재시도.
15분 기한은 아직 pending인 원본 업로드/prepare에 적용한다. 이미 ITEM에 연결된 stored/failed session은 owner 재시도 가능.
uploaded→queued→extracting→queued, metadata.upload.extraction.status=pending|running|complete|failed.
세션 기한과 서명 토큰 만료 이후 2h15 안전 window·ITEM 무참조·inactive lease 조건의 orphan 정리만 지원한다.

안전 오류 code만 반환한다: 401 UNAUTHORIZED, 403 FORBIDDEN, 404 ITEM_NOT_FOUND,
409 IDEMPOTENCY_CONFLICT/UPLOAD_IN_PROGRESS/STALE_ATTEMPT, 410 UPLOAD_EXPIRED,
503 STORAGE_UNAVAILABLE/WORKER_UNAVAILABLE/OCR_UNAVAILABLE, 기타 validation/parser/OCR 오류 422.
provider body/secret/filename/text/signed URL을 오류·로그에 담지 않는다.

metadata.upload.extraction은 method/provider/providerVersion/execution/language/extractionVersion을 가진다.
embedded/pdfjs/6.4.299/server/null 또는 ocr/tesseract.js/7.0.0/client/kor+eng만 새 저장에서 허용한다.
mixed root는 method/provider/providerVersion/execution=mixed, language=kor+eng이며 정확한 origin은 page별로 남긴다.
version=upload-text-v1은 기존 소비자 호환을 위해 extractionVersion과 함께 유지한다.
confidence/providerVersion은 client reported 참고값이고 서버가 실제 브라우저 engine 실행을 증명하지 않는다.
page locator는 추출 text 위치이며 원본과 OCR text의 의미 일치/원문 highlight를 보증하지 않는다.

기존 Upload Migration/bucket/policy와 사용자 승인한 provider-neutral RPC Migration은 ai-hub-dev에 적용됐다.
최소 실제 PDF/브라우저 이미지 OCR/ITEM/dedupe/소유권 검증 PASS. Vercel/Linux 및 모바일 성능은 후속 TODO.
Cloud Vision/Cloud Run/Billing/OCR ADC는 MVP 제외, 기존 ADC 보존. Gemini/Classification/Action/Deadline/Embedding 실행 없음.

## 25. 승인된 Search MVP API (Search-1 보완 / Search-2)

이 절은 초기 10절의 answered/insufficient_evidence/Gemini Answer를 대체한다. 제품 기준은 docs/SPEC.md 37절이다.

### POST /api/v1/search

Request: {query, filters?:{source?:item_source[], format?:item_format[], from?:YYYY-MM-DD|null, to?:YYYY-MM-DD|null}, limit?:number, semantic?:boolean, cursor?:string|null}.
trim/NFC Query 1~500 code points, request 최대 16KiB, limit 기본 20/최대 50, semantic 기본 false다.
userId/vector/embedding/provider/version/topic과 알 수 없는 필드는 거절한다.
semantic=true는 Query 외부 전송 선택이다. 프론트는 Gemini Free Tier 조건을 사전에 표시한다.
Unpaid Services는 입력·출력이 제품/ML 개선과 사람의 검토에 사용될 수 있으므로 민감·기밀·개인 Query를 보내지 않는다.
[공식 데이터 사용 조건](https://ai.google.dev/gemini-api/terms#unpaid-services)과 SPEC 37절의 환경별 Paid/Unpaid 확인을 따른다.
서버 disabled이면 keyword fallback/degraded이며 클라이언트 값으로 서버 정책을 변경하지 않는다.

Response: {coverage:{scope:owner_corpus,totalItems,semanticIndexedItems}, status:results|no_results, intent:documents|actions, mode:keyword_only|hybrid|action_sql, degraded,
results, limit, nextCursor, embeddingVersion, appliedFilters, timezone:Asia/Seoul, warning,
semantic:{requested,querySentToProvider,provider,disclosure}, debounceMs:350, maxResults:200, truncated, retryAfter}.
Cache hit는 querySentToProvider=false, 실제 실패 전송 시도는 true다. Cursor 페이지 info는 최초 실행 snapshot 정보다.

ITEM 결과는 kind,itemId,title,source,format,score,matchType,excerpt,matchedChunks,detailUrl,originalUrl,
originalEndpoint,sourceDate,sourceDateKind,calendar다. matchedChunks에는 chunkId/index(미색인 fallback은 null),
excerpt,location(field,offsetUnit=unicode_code_point,startChar,endChar,page,tabId,method)을 반환한다.
start/end는 0-based/end-exclusive, page는 1-based다. Full text/raw embedding/hash/내부 revision/전체 metadata는 반환하지 않는다.

Action 결과는 kind=action,actionId,title,type,status,deadlineStatus,deadlineDate,deadlineAt,requirements,
conditions,matchType=action_sql,score=0,sources[{itemId,title,source,format,text,location,originalUrl,detailUrl}]다.
문서 relevance와 importance 점수는 합치지 않는다. 기간 검색은 실제 confirmed deadline/current Evidence만 사용한다.

Pagination은 동일 query/filters/semantic/limit에 nextCursor를 넣는다. Snapshot TTL 5분/최대 200,
HMAC에 session/offset/context/limit/version/만료를 결합한다. 타 사용자/query/version/tamper는 거절하고,
만료는 410 CURSOR_EXPIRED로 재검색한다. 삽입은 기존 snapshot에 추가하지 않는다.
변경·삭제 결과를 제거한 window를 다시 채우지 않으므로 빈 results에도 cursor가 있을 수 있다. 종료 기준은 nextCursor=null이다.
Rate는 사용자 request 30/min, uncached document/query embedding 10/min, index 5/min이다. 429에는 Retry-After 초 단위를 반환한다.
owner/query/effective filters/Asia/Seoul/embeddingVersion cache TTL 5분, 동시 lease 20초, cursor 페이지 Query Embedding 호출 0이다.
응답은 private,no-store/X-Search-Debounce-Ms=350이다. 프론트는 350ms debounce/AbortController/Retry-After를 준수한다.
서버 보안은 debounce에 의존하지 않는다.

### POST /api/v1/items/{itemId}/index

빈 body 또는 {retry?:boolean}. 본인 ITEM만, cycle 최대 8개 독립 chunk/동시 1/시간 예산 35초다.
Semantic은 서버 enabled+비민감 ITEM allowlist로만 결정하며 client consent/provider/vector 입력은 금지한다.
state=complete|pending|failed|skipped_limit, nextChunk/chunkCount/semantic/version은 상태별로 포함한다.
Pending은 같은 endpoint로 resume한다. Transient retryAfter를 존중하고 최초 포함 3회로 제한한다.
retry=true는 본인의 명시적인 수동 budget 초기화이며 index rate limit은 유지한다.

### GET /api/v1/items/{itemId}/similar?limit=5

limit 1~10, 다른 query/중복 limit은 거절한다. 본인 ITEM/같은 version의 최대 4개 대표 chunk로 비교하며 provider 호출은 0이다.
Response: {status:results|not_indexed,embeddingVersion,results:[{itemId,title,source,format,score,detailUrl,originalUrl}]}.
Keyword-only/pending은 not_indexed다. 자신을 제외하며 foreign와 없는 ITEM은 동일 404다.

Auth 401, input 400, size 413, ITEM 404, lease/stale 409, cursor expiry 410, quota 429,
config/provider/storage 503, invalid vector 502다. Provider raw body/Secret/개인 Query는 오류 로그에 출력하지 않는다.
일반 Detail 조회의 기존 사용자 client 경계는 유지한다.

Search-3 실제 dev E2E 및 비민감 기존 자료 회귀 PASS. 응답 coverage는 필터 결과 개수가 아닌 본인 전체 corpus다.
semanticIndexedItems는 active version/current revision/완료 generation의 유효 vector가 있는 ITEM 수다.
Coverage도 최초 결과 snapshot에 고정한다. 개인정보·자격증명 파생값은 API 응답/검증 비교에 포함하지 않는다.
검색 검증 절차는 docs/setup/SEARCH_VALIDATION.md를 따른다.

## 26. Polished UI 2.0 통합 범위 (2026-10-05)

GET /api/v1/connections의 기존 google 요약에 다음 공개 필드를 추가한다.

```json
{"capabilities":{"gmail":true,"drive":true,"calendar":true}}
```

값은 소유 connection의 저장 granted scopes에서 계산한 권한 보유 여부다.
Drive는 metadata.readonly와 documents.readonly 두 권한 모두 필요하다.
권한 보유와 연결 status는 별개이며 disconnected/error에서는 수집 버튼을 활성화하지 않는다.
raw scopes, token, ciphertext, sync_state는 이 응답에 추가하지 않는다.

Frontend는 ITEM list/detail의 기존 session query, Search의 POST 결과 및 Similar GET,
Google authorize/sync/drive collect/calendar collect/disconnect, Upload create/prepare/complete/original,
기존 Gmail analyze를 연결한다. Search Action 결과는 open Action만 포함하므로 완료 목록을 주장하지 않는다.
Classification/Action 조회는 기존 persisted 값만 사용하고 User Edited 값을 수정하지 않는다.
설계된 Classification PATCH / Action status PATCH / 독립 Action GET / 삭제 route는 아직 존재하지 않는다.
현 통합에서 새로운 DB schema/RPC/권한/Migration 변경은 없다.

## 27. FINAL BACKEND GAP FIX 계약 (2026-10-06)

이 절은 26절의 쓰기 미구현 기록과 Gmail-only 실행 범위를 대체한다. 기존 9절/11절 route convention을 유지한다.

### PATCH /api/v1/items/{itemId}/classification

같은 Origin의 인증 사용자/ITEM owner만 허용한다. primaryTopic/documentType/tags 중 1개 이상만 허용하고
unknown 필드·중복 소유권 입력·잘못된 ID/값은 거절한다. body 최대 8192 bytes.
Topic trim/NFC 1~100 code points, documentType 기존 enum, tags null 또는 최대 20개(각 1~50 code points),
control character 거절, tags trim/NFC/중복 제거. 기존 9절처럼 생략은 기존 override 유지, null은 해당 override 해제, []는 명시적 빈 tags다.
기존 authenticated set_classification_override RPC를 재사용한다. 부분 PATCH는 현 override를 읽어 합친 후 RPC에 전달하며,
동일 사용자의 동시 편집은 마지막 저장 snapshot이 우선한다. AI 재분석은 user 컬럼을 건드리지 않는다.

Response: {aiClassification:{primaryTopic,documentType,tags},userClassification:{primaryTopic,documentType,tags}|null,
effectiveClassification:{primaryTopic,documentType,tags,origin,available,origins},editedByUser,updatedAt,userEditedAt}.
여기 updatedAt은 Classification row 시각이다. Detail의 기존 aiClassification/userClassification/effectiveClassification도 즉시 반영한다.
401 anonymous / 404 foreign·없는·invalid ID / 400 입력 / 403 Origin / 413 size / 503 storage. private,no-store.

### PATCH /api/v1/actions/{actionId}/status

Body는 {status:"open"|"completed"}만 허용한다. client completedAt/userId/Deadline/Evidence 등의 필드는 거절한다.
owner를 session/RLS SELECT로 확인한 뒤 서버에서 status/completed_at만 owner+updated_at+status CAS로 갱신한다.
완료 시 서버 ISO 시각, 복원 시 null. 같은 상태는 기존 완료 시각/updatedAt까지 보존하며 쓰지 않는다.
CAS 충돌은 최대 3회 재조회 후 409. Source/Evidence/ITEM/Deadline 변경 없음.
Response: {actionId,status,completed,completedAt,updatedAt}. 인증·Origin·body 상한·오류 보안은 Classification과 동일하다.

### GET /api/v1/actions

기존 11절 query type/status/deadlineStatus/cursor/limit를 구현한다. status 기본 open, limit 기본20/최대50.
알 수 없는 query·중복 파라미터·잘못된 enum/cursor는 400. owner/status/type/deadline 조건으로 created_at/id DESC keyset pagination.
cursor는 기존 서버 Search secret을 사용한 HMAC이며 user/filter/limit에 묶인다. Search 결과 snapshot cursor와 호환되지 않는다.
Response: {results:[Search Action과 동일한 안전한 kind/actionId/title/type/status/deadlineStatus/deadlineDate/deadlineAt/
requirements/conditions/sources projection],nextCursor,limit,status}. current Evidence만 반환하고 raw metadata/analysisKey/credentials는 제외한다.
완료/복원 뒤 새 조회를 실행한다. Search SQL도 계속 open만 반환하며 기존 snapshot은 updated_at 불일치 Action을 제외한다.

### POST /api/v1/items/{itemId}/analyze

기존 endpoint를 유지하되 owner Gmail/email, Drive/document, metadata.upload.extraction의
version=upload-text-v1/status=complete인 Upload/pdf,image canonical text를 허용한다.
Calendar/manual/지원하지 않는 format/빈·상한 초과 본문은 422이며 claim/provider/write를 하지 않는다.
빈 body 또는 {}만 허용한다. userId/model/force/raw OCR 등 다른 필드는 400, body 최대8192 bytes.
본문·모델·schemaVersion fingerprint가 같고 검증 가능한 저장 결과가 있으면 cached=true로 provider/write를 skip한다.
queued/failed/indexing/completed에서 현재 updated_at으로 claim하고, analyzing 등의 상태는409이다.
성공 응답은 기존 {cached,action_count,created_count,reused_count,processing_status}; raw Gemini response는 반환하지 않는다.
Gmail은 기존 persist_gmail_item_analysis, Drive/Upload는 신규 서버 전용 persist_eligible_item_analysis로 atomic 저장한다.
503/timeout/validation/저장 실패는 해당 claim만 실패 표시하며 원문/기존 분석/user override/다른 ITEM은 보존한다.
Gemini 429/503은 기존 최초+2회/총120초 정책, validation/malformed는 retry하지 않는다.

### 수집 후 bounded orchestration

Gmail sync 및 Drive collect에 {analysisItemIds:string[],analysisDiscoveryFailed:boolean}를 추가한다.
해당 작업에서 정상 저장·재사용한 owner ITEM 중 eligible/current analysis가 아닌 ID만 반환한다. 새로운 전역 backfill 목록이 아니다.
후보 조회 실패는 기존 수집 결과를 실패로 바꾸지 않는다. 클라이언트는 최대3건 순차 analyze하며 부분 실패를 격리한다.
Upload의 기존 저장 결과 itemId를 동일 흐름에 연결한다. Calendar 응답·분석 정책은 바꾸지 않는다.
미실행 대상은 pending 수로 안내하고 Detail에서 수동 재시도한다. 새 worker/queue/RPC batch API는 추가하지 않는다.

신규 additive RPC Migration 20261005162738_persist_eligible_item_analysis.sql은 승인 후 ai-hub-dev에만 적용했다.
후속 명시 승인으로 20261006000216_restrict_eligible_analysis_to_drive_upload.sql을 적용해 같은 신규 RPC에서
Gmail 허용 조건을 제거했다. 신규 RPC는 Drive/document 및 extraction 완료 Upload/pdf,image만 허용한다.
anon/authenticated EXECUTE 불가, service_role 전용이며 owner+ITEM 조건을 유지한다. 추가 RPC는 총 1개다.
Gmail 원본 RPC/table/column/enum/RLS/Storage policy 변경은 없다.
