# AI Structured Output v0.2 — Phase 6A 검토 초안

**상태: 2026-10-04 승인된 검토 기록. 현재 구현 기준은 루트 AI_OUTPUT_SPEC.md / AI_OUTPUT_SCHEMA.json v0.2다.**

루트 `AI_OUTPUT_SPEC.md` / `AI_OUTPUT_SCHEMA.json` v0.1을 기준으로 한 변경 제안이다. 이 폴더의 같은 이름 파일은 검토용이며, 승인 전 루트 기준본을 대체하지 않는다. Notion v0.5 원본, 루트 SPEC, 기존 DB 테이블/Migration 및 현재 서비스 코드는 변경하지 않는다.

## 1. 변경 이유와 범위

v0.1은 `classification`과 `actions`만 반환한다. 행사일을 Deadline과 혼동하지 말라는 규칙은 있지만, Action이 없는 행사 안내의 행사일을 별도로 보존할 수 없다.

v0.2 초안은 **ITEM 수준 `eventObservations`**만 추가한다. Action 내부에 두지 않으므로 행사 안내를 저장하기 위해 가짜 Action을 생성할 필요가 없다. 사용자 요청의 `event_date`는 이 관찰값의 `date`에 대응한다. JSON 이름은 기존 `startObservation` / `deadlineObservation`과 같은 camelCase를 따른다.

| 항목 | v0.1 | v0.2 제안 |
| --- | --- | --- |
| schemaVersion | `0.1` | `0.2` |
| Classification | Topic / Document Type / Tags | 변경 없음 |
| Action | title / type / requirements / conditions / start / deadline / evidence | 변경 없음 |
| 행사일 | 별도 출력 없음 | ITEM 수준 `eventObservations[]` |
| description | 없음 | 추가하지 않음 |

`eventObservations`는 필수 배열이며 행사/일정 정보가 없으면 `[]`다. 상한 10은 과도한 출력을 막기 위한 **초안 제안값**이다. 승인 전 확정 제품 기준으로 취급하지 않는다. 복수 행사를 하나의 날짜로 임의 선택하거나 행사 기간을 마감일로 치환하지 않는다. 동일 ITEM의 여러 행사 시점은 각각 원문 근거로 구분한다. 기간·행사 ID·Calendar event 모델은 이번 확장에서 추가하지 않는다.

## 2. 출력 예시

아래는 개인정보가 없는 합성 원문이다.

```text
2026년 10월 20일 설명회가 개최됩니다.
참가 신청은 2026년 10월 15일까지 접수합니다.
```

행사 관찰값:

```json
{
  "status": "confirmed",
  "date": "2026-10-20",
  "datetime": null,
  "rawText": "2026년 10월 20일",
  "evidence": {
    "text": "2026년 10월 20일 설명회가 개최됩니다.",
    "locator": {
      "kind": "unknown",
      "page": null,
      "section": null,
      "startChar": null,
      "endChar": null,
      "field": null
    }
  }
}
```

최상위 출력은 다음 네 영역을 갖는다.

```text
schemaVersion = "0.2"
classification = 기존 v0.1 구조
actions = 기존 v0.1 구조
eventObservations = 위와 같은 행사 관찰값 배열
```

예시의 참가 신청이 사용자에게 제공된 실제 선택이라면 `optional` Action 후보의 `deadlineObservation.date`는 `2026-10-15`다. `2026-10-20`을 deadline 또는 신청 start로 사용하지 않는다. 첫 문장만 있는 메일은 `actions=[]`와 행사 관찰값만 반환한다.

## 3. 행사 관찰값 검증

각 항목은 기존 날짜 Observation과 동일한 `status`, `date`, `datetime`, `rawText`, `evidence` 구조를 사용한다.

- `confirmed`: 날짜가 원문에서 명확히 확인되며 `date`와 Evidence가 반드시 존재한다.
- `needs_review`: 행사/일정 날짜 표현은 있지만 절대 날짜를 확정할 수 없다. `date`와 `datetime`은 null이고 원문 표현과 Evidence를 보존한다.
- 행사 정보가 없음: 빈 배열. 행사 항목에 `none` 상태를 넣지 않는다.
- `rawText`는 Evidence 안의 정확한 부분 문자열이어야 한다. Evidence text는 해당 ITEM `content_text`의 정확한 부분 문자열이어야 한다.
- 연도가 빠진 날짜, 기준일 없는 상대 날짜, 시간대 없는 시각은 임의 보완하지 않는다. 날짜만 확정 가능한 경우 `datetime=null`이다.
- 행사 날짜를 신청 시작일·마감일로 자동 복사하지 않는다. 두 역할이 실제로 같은 날짜라도 각각의 역할에 대한 별도 근거가 필요하다.
- 위치 정보는 추측하지 않는다. 서버가 본문 문자열 위치를 다시 검증하거나 계산한다.
- 행사 일정의 취소·변경·기간 병합, Calendar 연동은 이번 Phase에서 구현하지 않는다.

JSON Schema는 null 조합과 의미·원문 포함 여부를 모두 강제하지 못하므로 Schema 검증 후 위 의미 규칙을 별도로 검사한다. 실패한 출력은 Classification / Action / Evidence / 행사 결과에 저장하지 않는다.

## 4. description 추가 여부

현재 `actions` 테이블에 description 컬럼이 없다. 현재 Item Detail 조회/표시는 Action title/type/status/deadline과 별도 Evidence를 사용하며 description API 계약도 없다. 원문은 ITEM의 `content_text`, 제출·준비 사항은 `requirements`, 적용 조건은 `conditions`, 근거는 `action_sources`에 이미 보존할 수 있다.

따라서 이번 초안은 description을 추가하지 않는다. 단순 요약 필드는 기존 값과 중복되고 추가 환각 검증이 필요하다. 추후 독립적인 저장·표시 요구가 확정되면 출력 명세와 DB/API 계약을 함께 검토한다.

## 5. 기존 DB 저장 매핑 제안

실제 ai-hub-dev의 `classifications`, `actions`, `action_sources` 컬럼을 읽기 전용으로 확인했다. 행사일·description 전용 컬럼은 없다.

| 출력 | 기존 저장 위치 | 저장 원칙 |
| --- | --- | --- |
| classification.primaryTopic | classifications.ai_primary_topic | 기존 upsert_ai_classification RPC만 사용 |
| classification.documentType | classifications.ai_document_type | 같은 RPC |
| classification.tags | classifications.ai_tags | 같은 RPC; user_* 미변경 |
| action.title / actionType | actions.title / action_type | 실제 행동과 원문 근거를 검증한 후보만 저장 |
| action.requirements / conditions | actions.requirements / conditions | 근거 없는 요구사항 생성 금지 |
| action.startObservation | actions.start_date / start_at | 신청·접수 시작일만 저장 |
| action.deadlineObservation | action_sources.observed_deadline_date / observed_deadline_at | 해당 ITEM의 마감 관찰값 |
| 최종 Action deadline | actions.deadline_status / deadline_date / deadline_at / deadline_source_id | 전체 current Evidence 비교 후 결정; 충돌 시 needs_review |
| action.evidence | action_sources.evidence_text / evidence_locator | current Action+ITEM Source는 1개; 추가 인용·날짜 근거는 locator JSON 내 검증된 인용 목록으로 보존하는 방안 |
| eventObservations | items.metadata.aiAnalysis.result.eventObservations | ITEM 수준 JSON; 행사 전용 테이블/컬럼 불필요 |
| 검증된 전체 분석 결과 | items.metadata.aiAnalysis | 기존 Gmail metadata를 보존하면서 이 키만 병합 갱신 |

`metadata.aiAnalysis`는 **신규 JSON 키 사용 제안**이며 승인 전 실제 데이터에 쓰지 않는다. 포함할 내용은 schemaVersion, 명시적으로 설정된 model, 서버 계산 inputFingerprint, analyzedAt, 검증된 result다. Secret, Token, JWT는 포함하지 않는다. 기존 from/to/threadId/historyId/attachment metadata를 유지한다.

복수 Evidence는 Source row 수를 무작정 늘리지 않는다. 대표 원문을 `evidence_text`에 두고, 같은 Source의 모든 검증된 인용과 날짜 근거를 `evidence_locator` JSON에 담는 저장 형식도 승인 후 구체화한다. confirmed의 deadline_source_id는 마감 관찰값을 가진 같은 Action의 current Source를 가리켜야 한다. ITEM 수준 행사 Evidence는 Action이 없더라도 `items.metadata` 안에 남는다.

행사일은 `actions.start_date` 또는 `deadline_date`에 우회 저장하지 않는다. Event 저장 자체에는 Migration이 필요하지 않다. 별도 날짜 필터/인덱스/UI/API 노출은 이번 제안에 포함되지 않는다.

## 6. Transaction과 권한

기존 DB는 Action에 current Evidence가 없으면 deferred validator에서 commit을 거부한다. Supabase의 개별 REST INSERT 두 번은 같은 transaction이 아니므로 신규 Action과 Source를 순차 저장할 수 없다. 기존 함수 목록에는 이 원자적 저장을 담당하는 RPC가 없다.

따라서 구현 재개 시 **새 server-only 저장 RPC Migration이 필요**하다. 기존 테이블·제약·RLS·applied Migration은 유지하고, 검증된 Classification·Action·Source·ITEM 분석 metadata 저장을 한 transaction에 묶는다. Classification은 RPC 내부에서도 기존 `upsert_ai_classification()`을 호출하며 user_*를 직접 변경하지 않는다.

예정 권한 경계:

- HTTP entry point는 서버의 `requireUser()`로 로그인 사용자를 확인한다.
- user_id / item_id / action_id 등 소유권을 Gemini가 결정하지 않는다.
- 서버가 현재 사용자 소유 ITEM을 확인하고 `p_user_id`를 설정한다. 모델/브라우저가 전달한 user_id를 신뢰하지 않는다.
- 저장 함수는 SECURITY DEFINER, `search_path=''`, 모든 테이블 참조를 schema로 한정한다.
- public/anon/authenticated EXECUTE를 제거하고 service_role 서버 모듈만 실행한다.
- 모든 ITEM / Action / Source 작업은 같은 사용자로 제한한다.
- 원문 스냅샷 변경을 감지해 오래된 출력 저장을 거부한다.
- Evidence 부모 잠금과 기존 deferred integrity trigger를 유지한다. 40P01 / 40001은 전체 저장 transaction 단위로 제한 재시도한다.

앞서 받은 개발 DB Migration 적용 승인은 출력 명세·매핑안 승인과 RPC 초안 검증 이후에 사용한다. **현재 Migration 생성·적용 결과로 기록하지 않는다.**

## 7. 재분석과 processing_status

- 동일 ITEM + 동일 원문 fingerprint + 동일 schema/model의 유효한 분석 artifact가 있으면 재사용해 중복 저장·불필요한 Gemini 호출을 피하는 방안이다.
- Action 재저장이 필요하면 기존 Action/Source를 재사용한다. 후보의 표현이 달라져 안전한 매칭이 불가능하면 새 Action을 추가하지 않고 검토 대상으로 남긴다.
- 동일 Action의 서로 다른 ITEM Source를 연결하는 정밀 의미 매칭은 기존 v0.1에서도 별도 정의 대상이다. 본 초안은 그 알고리즘을 임의 확정하지 않는다.
- 기존 user override와 Action 완료 상태를 AI가 덮어쓰지 않는다.
- 분석 성공 후 `analyzing → indexing`으로 넘겨 분석 결과 저장을 표시한다. Phase 6A에서는 Search Chunk / Embedding / Vector Index를 실행하지 않으므로 전체 파이프라인 `completed`로 표시하지 않는다.
- Schema/의미/Evidence 검증 실패 시 결과를 저장하지 않고 안전한 processing_error와 failed 상태만 기록하는 방안이다. 기존의 유효한 분석 데이터를 파괴하지 않는다.

## 8. 승인 후 검증 계획

실제 Gmail ITEM은 최대 5개만 분석한다. 합성 테스트는 실제 Gmail이나 Gemini를 호출하지 않는다.

1. 기존 v0.1 영역의 Schema 구조가 바뀌지 않았는지 확인하고 신규 행사 배열을 검증한다.
2. 단순 행사 안내: 행사일 저장, actions=[] 보장.
3. 실제 신청/제출 메일: Action, 근거, 마감일과 행사일 분리.
4. 연도/기준일이 불명확한 행사·마감: needs_review, 임의 날짜 생성 없음.
5. Evidence가 원문에 없는 출력: transaction 저장 전 거부.
6. 동일 ITEM 재실행: Classification/Action/Source 개수 비정상 증가 없음.
7. user override 있는 ITEM: AI 값만 갱신, user_*와 effective 값 유지.
8. 실패한 저장/동시 요청/원문 변경: 일부 결과만 남지 않는지 확인.
9. lint / typecheck / build 실행; Secret·Token·원문은 보고하지 않는다.

현재는 초안 작성 및 읽기 전용 pre-check만 수행했다. Gemini 실제 호출, 5건 분석 및 DB 저장 검증은 아직 실행하지 않았다.

## 9. 검토·승인할 항목

1. v0.2 필수 ITEM 수준 `eventObservations[]`와 초안 상한 10.
2. description을 추가하지 않는 결정.
3. `items.metadata.aiAnalysis`에 행사·전체 검증 결과를 저장하는 매핑.
4. Source당 복수 인용을 `evidence_locator` JSON에 보존하는 방향.
5. 성공 상태는 indexing, Action 매칭이 불명확하면 자동 추가하지 않고 검토 처리하는 방향.

승인되면 루트 출력 명세에 반영하고 Phase 6A 구현/RPC 초안 검증을 재개한다. Notion v0.5 원본은 수정하지 않으며 Phase 6B는 시작하지 않는다.
