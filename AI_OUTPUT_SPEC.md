# AI_OUTPUT_SPEC.md

# AI 통합 정보 허브 — AI Structured Output 명세 v0.1

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
  "schemaVersion": "0.1",
  "classification": {
    "primaryTopic": "등록금",
    "documentType": "billing",
    "tags": ["학교", "납부"]
  },
  "actions": []
}
```

### 필수 영역

- `schemaVersion`
- `classification`
- `actions`

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

- 연도가 없는 날짜의 연도 추정
- 상대 날짜를 기준일 없이 절대 날짜로 변환
- 시간대 추정
- 행사일을 신청 마감일로 사용
- 게시일을 Deadline으로 사용
- 문서 작성일을 Action 날짜로 사용

시간까지 명확한 경우에만 `datetime`을 반환한다.

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

구현 시 최신 Interactions API 방식의 개념은 다음과 같다.

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
✅ AI Structured Output v0.1

→ 다음: 실제 구현
```
