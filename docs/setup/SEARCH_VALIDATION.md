# 검색 검증 기준

합성 자료로 반복 검증하는 query 기준이다. 과거 배포의 PASS 결과를 현재 환경의 결과로 간주하지 않는다. 실제 검증은 개발 환경에서 별도 승인 후 수행하며 개인자료 전체 semantic backfill은 자동 실행하지 않는다.

## 합성 corpus

G1은 Gmail 장학금 안내, D1/D2는 Drive 상담 관련 자료, C1은 Calendar 회의, P1은 page map이 있는 PDF, I1은 합성 OCR 이미지 자료를 뜻한다. 검증 실행마다 이 역할의 합성 자료를 새로 준비하고 실제 ITEM ID는 공개 문서에 기록하지 않는다.

기준 시간대는 Asia/Seoul이며 상대 날짜 query의 기준 날짜는 실행 시 고정한다. 점수는 확률이 아니다.

## Query와 기대 결과

| 유형 | synthetic query / 조건 | 기대 결과 |
| --- | --- | --- |
| --- | --- | --- |
| exact title | 농협 장학금 제출 안내 | G1 Top-1 |
| exact phrase | 양식은 서명 후 제출합니다. | P1 Top-1 |
| semantic synonym | 정신적인 건강을 위한 도움 / semantic=true | D1 Top-3 |
| Korean partial | 심리상 | D1 Top-3 |
| Gmail | 재학증명서 / source=gmail | G1 Top-3 |
| Drive | 상담 프로그램 / source=drive | D1 Top-3 |
| Calendar | 주간 회의 / source=calendar | C1 Top-3 |
| Upload PDF | 서명 후 제출 / upload+pdf | P1 Top-3 |
| Upload image OCR | ENGLISH DOCUMENT TEST / upload+image | I1 Top-3 |
| source filter | 농협 / gmail | G1 Top-3 / 필터 밖 0 |
| format filter | 제출서류 / pdf | P1 Top-3 / 필터 밖 0 |
| date filter | 팀 회의 일정 / 2026-10-05 | C1 Top-3 |
| no-result | ZXQ무관고유어97531 / keyword | 결과 0 |
| Similar Items | D1 유사 자료 | D2 포함 / self·foreign 제외 |
| Action | 해야 할 일 / 마감 | 원문 있는 open Action |
| Deadline | 이번 주 제출 / 내일까지 / 내일까지 제출 | A1 포함 / needs_review 제외 |
| pagination | 집합검증표식 / limit=3 | 14개 중복·누락 0 |
| degraded | 재학증명서 / semantic=true, 서버 disabled | keyword 결과 유지 |

## 회귀 확인

- 원문 substring·locator, Source·Format·날짜 필터가 실제 자료와 일치해야 한다.
- exact title/phrase와 source date/ID의 동률 규칙을 확인하며 importance를 relevance에 섞지 않는다.
- 사용자·필터·시간대·embedding version별 cache와 cursor 격리를 검사한다.
- 다른 사용자의 자료, 삭제된 원문, raw embedding이 노출되지 않아야 한다.
- 429·503·timeout·잘못된 vector 응답은 격리 테스트로 검사하며 실제 provider 성공으로 확대하지 않는다.
- User Edited·Action 완료 상태·원문 Evidence를 유지하고 stale 결과를 저장하지 않는다.
- no-result query 하나의 성공을 모든 semantic 무관성의 보장으로 해석하지 않는다.

## 실행 도구

[테스트 안내](../../tests/README.md)를 참고한다. `npm run test:search`는 격리 검사이며 `tests/test-search-live.mjs`, `tests/test-search-backfill-live.mjs`, `tests/test-search-stored-regression.mjs`는 별도 환경·데이터 승인 조건을 확인한 뒤 실행한다.
