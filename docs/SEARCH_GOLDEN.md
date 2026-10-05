# Search-3 golden query / quality gate — PASS

2026-10-05 ai-hub-dev에서 검증했고 사용자가 핵심 검색 PASS를 인정했다. Search-3는 COMPLETE다.
실제 document/query embedding은 synthetic/non-sensitive만 사용했으며 개인자료 semantic backfill은 미실행이다.

## Corpus와 판정 범위

A 20 ITEM/B 1 ITEM을 실제 schema에 fixture로 생성했다. Google source는 새 외부 수집 없이 생성했고,
PDF는 page map이 있는 검색용 text fixture다. Image는 Upload-3에서 실제 Tesseract로 추출했던 비민감 합성
OCR text와 metadata를 재사용했다. Search 검증을 새 OCR/Google 수집 E2E로 확대하지 않는다.
A의 five-source 대표 6 ITEM/7 chunk를 semantic 색인했으며 최초 coverage는 6/20이다.
나머지 14 distractor는 keyword corpus다. B는 사용자 격리 fixture이며, 별도 사용자 2명은 5 ITEM씩 backfill에 사용했다.
테스트 사용자 4명과 해당 데이터는 정리했다. 안정적 테스트 식별자는 ignored 기록에만 보관한다.

Active: gemini / gemini-embedding-2 / 768 / gemini-embedding-2:768:retrieval-v1:chunk-v1.
기준 timezone은 Asia/Seoul, 기준 주는 2026-10-05~11이다. score는 확률이 아니다.

## Golden 결과

| 유형 | synthetic query / 조건 | 사전 기대 | 실제 결과 | 판정 |
| --- | --- | --- | --- | --- |
| exact title | 농협 장학금 제출 안내 | G1 Top-1 | Rank 1 | PASS |
| exact phrase | 양식은 서명 후 제출합니다. | P1 Top-1 | Rank 1 / page 2 | PASS |
| semantic synonym | 정신적인 건강을 위한 도움 / semantic=true | D1 Top-3 | Rank 2 / hybrid | PASS |
| Korean partial | 심리상 | D1 Top-3 | Rank 1 | PASS |
| Gmail | 재학증명서 / source=gmail | G1 Top-3 | Rank 1 | PASS |
| Drive | 상담 프로그램 / source=drive | D1 Top-3 | Rank 1 / tab range | PASS |
| Calendar | 주간 회의 / source=calendar | C1 Top-3 | Rank 1 | PASS |
| Upload PDF | 서명 후 제출 / upload+pdf | P1 Top-3 | Rank 1 / page 2 | PASS |
| Upload image OCR | ENGLISH DOCUMENT TEST / upload+image | I1 Top-3 | Rank 1 / actual saved OCR range | PASS |
| source filter | 농협 / gmail | G1 Top-3 / 필터 밖 0 | Rank 1 / 필터 밖 0 | PASS |
| format filter | 제출서류 / pdf | P1 Top-3 / 필터 밖 0 | Rank 1 / 필터 밖 0 | PASS |
| date filter | 팀 회의 일정 / 2026-10-05 | C1 Top-3 | Rank 1 / 다음날 end-exclusive 제외 | PASS |
| no-result | ZXQ무관고유어97531 / keyword | 결과 0 | results=[] / cursor=null | PASS |
| Similar Items | D1 유사 자료 | D2 포함 / self·foreign 제외 | D2 포함 / 누출 0 | PASS |
| Action | 해야 할 일 / 마감 | 원문 있는 open Action | SQL Action / 마감은 confirmed만 | PASS |
| Deadline | 이번 주 제출 / 내일까지 / 내일까지 제출 | A1 포함 / needs_review 제외 | 기대 날짜·근거 / parser 호출 0 | PASS |
| pagination | 집합검증표식 / limit=3 | 14개 중복·누락 0 | 14개 고유 결과 / cursor 변조·필터 변경 차단 | PASS |
| degraded | 재학증명서 / semantic=true, 서버 disabled | keyword 결과 유지 | keyword_only / degraded=true / 외부 전송 0 | PASS |

12개 rank query 기대 ITEM hit=100%, exact source substring/locator 및 필터 검증 PASS.
Cross-user/삭제된 원문/raw embedding leakage=0. Keyword no-result를 semantic 무관성 전반의 보장으로 확대하지 않는다.
동률은 exact title/phrase 및 source date/ID 규칙으로 결정한다. importance는 relevance에 섞지 않는다.

## 추가 회귀

실제 HTTP 인증/validation, owner RLS/RPC GRANT, hybrid RRF, cache의 owner/filter/timezone/version 격리,
서버 quota 429, Similar 추가 provider 호출 없음, 다른 embeddingVersion 배제, unchanged/User Edited/locator reuse,
제목·변경 PDF page의 선택적 재Embedding, stale commit/cascade PASS.
별도 synthetic 5 ITEM batch backfill은 concurrency 1, 모의 429 이후 resume, cycle 최대 8 chunk 및 progress PASS.
429/503/timeout/malformed/길이 불일치/zero/nonfinite vector는 격리 mock으로 검사했다.
기존 개인자료는 Library/Detail/keyword 및 비민감 상태/ownership/metadata 보존만 검증했다.
Token/credential 직접 비교나 Token 파생값 조회는 마감 검증에 사용하지 않았다.

실제 E2E 30 checks, SQL 10 checks 및 테스트 132 PASS 기록을 유지한다.
재검증하려면 사용자 지시 및 새 synthetic selection이 필요하며 개인자료 자동 backfill은 금지다.
