# AI 분석과 근거 연결

Gmail·Drive·Calendar·업로드·직접 입력은 모두 Unified ITEM으로 처리한다. 현재 실행 계약은 [AI 출력 명세](../ai/AI_OUTPUT_SPEC.md)와 root의 [JSON Schema](../../AI_OUTPUT_SCHEMA.json)이며, 과거 검토용 Schema는 실행에 사용하지 않는다.

## Action과 Event 분리

- Action은 사용자가 실제로 해야 하거나 선택해야 하는 행동이다. 날짜가 있다는 이유만으로 생성하지 않는다.
- 행사일·회의일은 ITEM의 `eventObservations`로 표현할 수 있다. 행사 안내를 저장하기 위해 가짜 Action을 생성하지 않는다.
- Action의 신청 시작일과 마감일, Event의 행사 날짜는 서로 다른 의미로 유지한다.
- 날짜가 불명확하면 확정 Deadline으로 바꾸지 않는다.

이 구분은 과거 AI v0.2 검토에서 도입되었으며 현재 명세와 Schema에 반영되어 있다.

## 검증과 저장

- 서버는 Schema와 원문 Evidence를 검증한 뒤 분석 결과를 저장한다.
- Evidence는 원문에서 추적 가능해야 하며, 근거 없는 날짜·행동·조건을 추측하지 않는다.
- 사용자 분류 수정값과 완료된 Action 상태는 AI 재분석으로 덮어쓰지 않는다.
- 검색 결과에서는 Source와 Evidence를 함께 확인할 수 있다.

구현은 `src/lib/gemini/validation.ts`, `src/lib/items/analysis.ts`, `src/lib/items/analysis-policy.ts`를 따른다. API 계약은 [API 명세](../api/API_SPEC.md)에 있다.
