# docs/ai/AI_OUTPUT_SPEC.md

# etc. — AI Structured Output 명세 v0.2

> 기준: 서비스 기획 및 개발 기준서 v0.5 + DB Migration v0.5 + API_SPEC v0.1  
> 목적: Gemini가 비정형 ITEM을 분석한 뒤 서버가 안전하게 검증·저장할 수 있는 후보 JSON을 생성한다.

---

## 1. 핵심 결론

AI 출력은 **DB 저장 명령이 아니라 후보 분석 결과**다.

```text
ITEM
→ Gemini Structured Output
→ JSON Schema 검증
→ 의미 규칙 검증
→ Evidence 검증
→ Action 중복/Source 병합
→ DB Transaction
```

AI가 최종 결정하지 않는 것:

- user_id / item_id / action_id
- 데이터 소유권
- 사용자 Classification Override
- 기존 Action과의 최종 중복 병합
- 여러 Source가 충돌할 때 최종 Deadline 선택
- Action 완료 상태
- DB 권한 / RLS
- processing_status
- deadline_source_id

---

## 2. 최상위 출력 구조

```json
{
  "schemaVersion": "0.2",
  "classification": {
    "primaryTopic": "등록금",
    "documentType": "billing",
    "tags": ["학교", "납부"]
  },
  "actions": [],
  "eventObservations": []
}
```

### 필수 영역

- `schemaVersion`
- `classification`
- `actions`
- `eventObservations`

Action이 없으면 `actions`는 반드시 빈 배열이다.

---

## 3. Classification

```json
{
  "primaryTopic": "등록금",
  "documentType": "billing",
  "tags": ["학교", "재학생", "납부"]
}
```

### 규칙

1. Primary Topic은 기본 1개다.
2. 기존 Topic 후보가 모델 입력에 제공되면 의미가 유사한 기존 Topic을 우선 재사용한다.
3. 사용자의 기존 Override 값은 모델 입력에 포함시키더라도 **AI 출력값으로 덮어쓰지 않는다**.
4. AI 결과는 DB의 `ai_*` 필드에만 반영한다.
5. Document Type은 다음 enum만 허용한다.

```text
notice
application
contract
billing
reservation
certificate
schedule
general
other
```

---

## 4. Action Candidate 생성 규칙

### 생성한다

사용자가 실제로 다음 중 하나를 해야 할 때만 Action Candidate를 반환한다.

```text
required = 반드시 해야 하는 행동
optional = 신청·선택할 수 있는 행동
check    = 조건 또는 대상 여부 확인이 필요한 행동
```

### 생성하지 않는다

다음만 존재하면 Action을 만들지 않는다.

- 날짜만 존재
- 행사 안내만 존재
- 단순 사실 설명
- 과거 완료 사실
- 사용자의 행동이 없는 공지
- Evidence가 없는 추론

예:

```text
"개강일은 3월 2일이다."
→ Action 없음

"등록금을 2월 28일까지 납부해야 한다."
→ required Action
```

---

## 5. Action JSON

```json
{
  "title": "등록금 납부",
  "actionType": "required",
  "requirements": [],
  "conditions": [],
  "startObservation": {
    "status": "confirmed",
    "date": "2026-10-21",
    "datetime": null,
    "rawText": "10월 21일부터",
    "evidence": {}
  },
  "deadlineObservation": {
    "status": "confirmed",
    "date": "2026-10-31",
    "datetime": null,
    "rawText": "10월 31일까지",
    "evidence": {}
  },
  "evidence": []
}
```

---

## 6. Deadline은 최종값이 아니라 Observation

이 설계가 v0.1에서 가장 중요한 부분이다.

Gemini는 **현재 ITEM에서 보이는 Deadline**만 반환한다.

```text
Gemini
→ deadlineObservation

Server
→ 다른 Source의 Observation과 비교
→ 최종 actions.deadline_status 결정
```

예:

```text
Gmail     10/20
Drive     10/31
```

AI가 어느 것이 최신인지 근거 없이 선택하지 않는다.

서버가 Source 이력과 현재 Evidence를 비교해:

```text
confirmed
또는
needs_review
```

를 결정한다.

따라서 AI Structured Output의 `deadlineObservation.status`와 DB의 최종 `actions.deadline_status`는 역할이 다르다.

---

## 7. Deadline Observation 규칙

### confirmed

원문에 Action의 실제 마감일이 명확히 존재한다.

```json
{
  "status": "confirmed",
  "date": "2026-10-31",
  "datetime": null,
  "rawText": "10월 31일까지"
}
```

### needs_review

마감 개념은 존재하지만 확정 날짜를 안전하게 만들 수 없다.

예:

- "추후 공지"
- "예산 소진 시까지"
- 문서 내부에서 서로 다른 마감일 발견
- 기준일 없이 "다음 주 금요일까지"
- 조건에 따라 날짜가 달라짐

```json
{
  "status": "needs_review",
  "date": null,
  "datetime": null,
  "rawText": "예산 소진 시까지"
}
```

### none

마감일 정보 자체가 없다.

```json
{
  "status": "none",
  "date": null,
  "datetime": null,
  "rawText": null,
  "evidence": null
}
```

---

## 8. 날짜 추측 금지

AI는 다음을 임의 계산하지 않는다.

- 기준일과 문맥 없이 연도가 없는 날짜의 연도 추정
- 상대 날짜를 기준일 없이 절대 날짜로 변환
- 시간대 추정
- 행사일을 신청 마감일로 사용
- 게시일을 Deadline으로 사용
- 문서 작성일을 Action 날짜로 사용

시간까지 명확한 경우에만 `datetime`을 반환한다.

2026-10-12 승인된 예외: 이번 배포는 Manual Text에 한해 서버가 입력 기준일 + Asia/Seoul과 원문 문맥으로 월·일의 연도를
해석할 수 있다. Gemini는 연도 생략 날짜를 needs_review/date=null 후보로 유지하고, 서버가
Evidence 검증 후 가장 가까운 자연스러운 연도를 정규화한다. 애매하면 needs_review를 유지한다.
구체적 기준일·모호성·지원 범위는 `docs/SPEC.md` 42절을 따른다. 원문 인용은 변경하지 않는다.

---

## 9. Start Observation

신청·접수 기간이 존재하면 시작일과 마감일을 분리한다.

```text
신청기간: 10월 21일 ~ 10월 31일
```

결과:

```text
startObservation.date    = 2026-10-21
deadlineObservation.date = 2026-10-31
```

행사일은 Start 또는 Deadline으로 자동 치환하지 않는다.

---

## 10. Evidence

Action은 Evidence 없이 존재할 수 없다.

각 Action Candidate:

```text
evidence.length >= 1
```

Evidence:

```json
{
  "text": "등록금을 10월 31일까지 납부해야 합니다.",
  "locator": {
    "kind": "page",
    "page": 2,
    "section": null,
    "startChar": null,
    "endChar": null,
    "field": null
  }
}
```

### locator.kind

```text
text_span
page
email_section
calendar_field
metadata
unknown
```

AI는 입력에 없는 Page 번호나 Character 위치를 만들어내지 않는다.

위치 정보가 제공되지 않았으면:

```json
{
  "kind": "unknown",
  "page": null,
  "section": null,
  "startChar": null,
  "endChar": null,
  "field": null
}
```

로 반환한다.

---

## 11. 서버 Semantic Validation

JSON Schema 통과만으로 DB에 저장하지 않는다.

서버는 다음 규칙을 추가 검증한다.

### Classification

- `primaryTopic` 공백 금지
- Tags 공백/중복 제거
- 지원 Document Type 확인

### Action

- title 공백 금지
- Evidence 1개 이상
- Evidence Text가 실제 ITEM 원문에 존재하는지 확인
- Action이 실제 사용자 행동을 나타내는지 확인

### confirmed Deadline

반드시:

```text
date != null
deadline evidence != null
```

이어야 한다.

### needs_review / none

DB 최종 Action에 날짜를 바로 확정 저장하지 않는다.

### datetime

```text
datetime != null
→ date != null
```

이어야 한다.

---

## 12. DB Mapping

### Classification

```text
classification.primaryTopic
→ classifications.ai_primary_topic

classification.documentType
→ classifications.ai_document_type

classification.tags
→ classifications.ai_tags
```

사용자 Override 필드는 변경하지 않는다.

### Action Candidate

서버가 기존 Action과의 중복 여부를 확인한다.

신규 Action이면:

```text
actions.title
actions.action_type
actions.requirements
actions.conditions
actions.start_date / start_at
```

를 저장한다.

### Evidence

```text
action.evidence
→ action_sources.evidence_text
→ action_sources.evidence_locator
```

### Deadline Observation

현재 ITEM에서 명확한 Deadline Observation이 있으면:

```text
action_sources.observed_deadline_date
action_sources.observed_deadline_at
```

로 저장한다.

그 후 서버가 전체 current Source를 기준으로 최종 Action Deadline을 결정한다.

---

## 13. 중복 Action 처리

Gemini가 DB Action ID를 결정하지 않는다.

```text
새 Candidate
→ 서버 Matching
→ 기존 Action 발견
   → Action 유지
   → 새 action_source 추가

→ 기존 Action 없음
   → 새 Action 생성
   → action_source 생성
```

중복 판정 로직은 후속 구현에서 별도 정의한다.

---

## 14. 실패 처리

다음은 재시도 또는 검토 대상으로 처리한다.

### Schema Validation 실패

```text
모델 출력 폐기
→ 제한된 횟수 재분석
→ 계속 실패하면 ITEM failed
```

### Semantic Validation 실패

예:

- confirmed인데 날짜 없음
- Evidence Text가 원문에 없음
- Action인데 evidence 없음

처리:

```text
DB 저장 금지
→ 재분석 또는 needs_review
```

---

## 15. Gemini 호출 방식

현재 Gemini Structured Output은 JSON Schema 기반 출력을 지원한다.

Interactions API의 개념 예시는 다음과 같다. Phase 6A 실제 구현은 아래 18절의 Generate Content REST 경계를 사용한다.

```text
response_format
  type = text
  mime_type = application/json
  schema = AI_OUTPUT_SCHEMA
```

Schema는 지나치게 깊거나 복잡하게 만들지 않는다.

JSON Schema는 형식 안정성을 제공하지만 **내용의 의미적 정확성까지 보장하지 않으므로 서버 Validation을 반드시 수행한다.**

---

## 16. 구현 원칙

```text
Gemini = Extraction / Classification Candidate
Server = Authority
Database = Enforced Integrity
```

이 원칙을 v1 전체에 적용한다.

---

## 17. 개발 단계

```text
✅ Wireframe
✅ DB Migration
✅ DB Optimization
✅ API_SPEC v0.1
✅ AI Structured Output v0.2

→ 다음: 실제 구현
```


## 18. 승인된 Phase 6A 확장 (2026-10-04)

- schemaVersion은 "0.2"다. v0.1 출력은 이 처리 경계에서 거부한다.
- ITEM 수준 eventObservations는 필수 배열이며 최대 10개다. 정보가 없으면 []다. Action이 없어도 행사 관찰값을 보존한다.
- 항목은 status(confirmed/needs_review), date, datetime, rawText, evidence다. confirmed는 명확한 원문 날짜와 근거가 필수이고 needs_review는 date/datetime=null이다.
- rawText는 Evidence 안의 정확한 부분 문자열이며 Evidence는 content_text의 정확한 인용이어야 한다. 시간대/상대 날짜를 추측하지 않는다. 연도 생략 월·일의 서버 해석만 8절의 승인된 예외를 따른다.
- 행사일은 actions.deadline_date나 start_date로 자동 복사하지 않는다. 실제 신청 시작/마감의 별도 근거가 있어야 한다.
- description은 추가하지 않는다. title/requirements/conditions/본문/Evidence를 사용한다.

### DB 저장 및 권한

classifications/actions/action_sources 테이블 구조는 유지한다. 기존 upsert_ai_classification()으로 ai_*만 갱신하고 user_*를 보호한다.

items.metadata.aiAnalysis에는 schemaVersion, model, inputFingerprint, analyzedAt, result를 저장한다. result는 검증된 전체 v0.2 출력이며 eventObservations를 포함한다. 기존 Gmail metadata를 병합 보존한다.

Action의 대표 인용은 action_sources.evidence_text에, Source의 모든 검증된 인용과 시작/마감 근거는 evidence_locator JSON에 저장한다. 인용 위치는 content_text의 Unicode code point 오프셋(0-based, end exclusive)으로 서버에서 검증/계산한다. confirmed는 같은 Action의 current Source를 선택한다. 출처 충돌 시 needs_review로 두고 임의 선택하지 않는다.

Classification + Action + Evidence + ITEM 분석 metadata 저장은 승인된 service_role 전용 RPC의 단일 transaction에서 수행한다. SECURITY DEFINER / search_path='' / 명시적 EXECUTE 제한을 사용한다. 로그인 사용자 확인은 서버 requireUser(), 모든 DB 소유권은 서버에서 정한 user_id로 제한한다. 실패 시 전체 rollback한다.

### 재분석

동일 ITEM/원문 fingerprint/schemaVersion/model의 검증된 결과는 재사용한다. 재저장해도 동일 Action/current Evidence를 재사용하고 내용 변경이 있을 때만 Source history를 추가한다. 기존 Action 완료 상태를 바꾸지 않는다. 표현 변경/삭제 후보의 매칭이 모호하면 자동 추가/삭제하지 않고 검토 오류로 처리한다. Cross-ITEM 의미 매칭은 별도 정의 전 임의 구현하지 않는다.

원문 스냅샷이 바뀌면 오래된 출력 저장을 거부한다. Schema/의미/Evidence 검증 실패 시 결과 저장 금지, 안전한 failed 상태만 기록한다. Phase 6A 성공은 indexing 대기 상태다. Search Chunk/Embedding 미실행 상태를 completed로 표시하지 않는다.

Gemini 호출은 서버 전용 GEMINI_API_KEY와 명시적인 GEMINI_MODEL을 사용한다. 공식 Generate Content REST Structured Output을 사용하며 SDK 추가 없이 처리한다. 실제 검증은 저장된 Gmail ITEM 최대 5개로 제한하고 이메일 원문/개인정보/Secret/Token을 보고하지 않는다.

사용자 요청에 따라 429/503만 최대 3회 시도(최초 1회 + 재시도 2회)한다. 전체 호출 제한은 120초다.
Retry-After를 존중하되 10초를 초과하는 대기는 요청 안에서 수행하지 않고 실패로 반환한다.
출력 검증 오류/다른 HTTP 오류/네트워크 불명확 실패는 자동 재시도하지 않는다. 모델은 자동 변경하지 않는다.
실제 검증 스크립트는 재시도 소진 시 batch를 중단하고 PARTIAL로 보고한다.
