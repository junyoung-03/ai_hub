# 독립 광고·홍보 판별 최종 계약

STATUS: PROMOTIONAL_CONTRACT_READY — 승인된 수정사항을 반영한 설계 계약. 구현·Migration 적용은 별도 단계다.

## 1. 기존 구조와 변경 경계

Topic / Document Type / Tags는 정보 분류이며 광고 판별에 재사용하지 않는다. 기존 classifications의 AI 값, 필드별 사용자 override, 빈 tags와 null의 의미를 유지한다. noise override는 완전히 독립적이다.

현재 AI_OUTPUT_SCHEMA.json v0.2는 Classification / Action(Deadline 포함) / eventObservations를 반환한다. AI Event는 items.metadata.aiAnalysis에 저장된다. Library와 Home 최근 자료는 listItems를 공유하고 Search는 별도 SQL 후보 선정·snapshot을 사용한다.

이 문서는 승인된 계약 기준이다. 후속 구현 승인은 로컬 코드·Migration 작성 및 격리 개발 PostgreSQL 검증까지이며 운영 DB·배포는 제외한다. 숨김은 visibility filter이며 Google 원본, ITEM, 검색 인덱스 또는 Action / Deadline / Event 삭제가 아니다.

## 2. Gemini 단일 호출과 AI 출력

광고 판별만을 위한 별도 Gemini 호출·요청 경로·전용 재시도는 금지한다. 기존 ITEM Gemini 분석 1회의 structured output에서 Classification / Action / Deadline / Event / noiseAssessment를 함께 반환한다. 기존 외부 오류 재시도 정책을 유지하며 광고 때문에 호출·재시도 횟수를 늘리지 않는다.

AI_OUTPUT_SCHEMA v0.3 계약:

- 기존 classification / actions / eventObservations의 이름·형태·의미를 유지한다.
- schemaVersion은 0.3, 새 noiseAssessment 객체는 필수다.
- v0.2 저장 결과도 계속 읽는다. noiseAssessment 부재는 미판정이며 normal로 조작하지 않는다.
- 분석 캐시 키에 schemaVersion을 포함한다. 신규 분석 또는 명시적으로 요청한 재분석부터 v0.3을 적용한다. 기존 결과를 자동 재분석하지 않는다.
- Gemini용 구조 schema, 타입, 검증기, 저장 RPC, Detail reader를 함께 갱신한다. v0.2/v0.3 읽기 호환성을 확보한 뒤 새 writer를 활성화한다.

noiseAssessment 객체:

- verdict: normal / promotional / uncertain.
- confidence: 0~1 숫자 또는 null. 참고 정보이며 숫자만으로 숨기거나 임의 임계값으로 promotional로 승격하지 않는다.
- evidence: 원문 exact substring과 기존 Evidence 형식 locator의 목록. promotional에는 비어 있지 않은 근거가 필수다. 서버가 원문 일치·Unicode 문자 위치를 검증한다.
- reasons: discount / coupon / sales / marketing_newsletter / general_promotion / non_promotional / insufficient_context 중 판정 사유 목록. uncertain에는 insufficient_context가 필요하다.
- protectionSignals: payment / billing / contract / security / account / service_outage / personal_obligation / uncertain_relationship과 각각의 원문 Evidence 목록. 서버 보호 판단의 입력이며 최종 visibility가 아니다.
- 모델은 user_id / item_id / user_override / effective_visibility / DB 명령을 반환하지 않는다. 원문 내 지시문은 신뢰하지 않는 데이터다.

혼합 문서는 promotional과 보호 신호를 함께 반환할 수 있다. Action / Deadline / Event / 중요 알림이 있다고 ai_verdict를 normal로 바꾸지 않는다. 애매한 판정은 uncertain을 유지한다.

기존 분석과 noiseAssessment를 검증하고 Action / Deadline / Event 저장과 같은 트랜잭션에서 assessment를 저장한다. 완료 전 자동 숨김을 활성화하지 않는다. 실패 시 부분 저장하지 않고 자동 숨김 유효성 조건을 만족하지 않은 것으로 처리한다. 사용자 override는 유지한다.

## 3. DB 계약 — 미적용

public.item_noise_assessments 독립 테이블을 사용한다. classifications 확장이나 metadata-only 대안은 채택하지 않는다.

- ITEM당 1행. item_id 유일성 및 (item_id, user_id) → items(id, user_id) 복합 FK.
- AI 영역: ai_verdict nullable(normal/promotional/uncertain), confidence nullable, evidence, reasons, protection_signals, assessment_version, model, input_fingerprint, analyzed_at.
- 사용자 영역: user_override nullable(force_show/force_promotional), user_edited_at.
- ai_verdict=null은 미판정이다. 사용자 override를 먼저 저장할 수 있으며 normal로 기록하지 않는다.
- 행 없음 또는 ai_verdict=null이고 override도 없음 → SHOW.
- protection_state와 effective_visibility는 현재 데이터·유효성에서 서버가 계산하는 파생값이다. 별도 쓰기 가능한 진실값으로 저장하지 않는다.
- 원문·제목·분석 입력 변경, 지원하지 않는 판정 버전은 기존 AI 숨김 근거를 무효화한다. Action / Deadline / Event 변화는 현재 보호 상태에 즉시 반영한다. user_override는 변경하지 않는다.
- 최소 인덱스: item_id 유일 인덱스와 소유자/판정 조회 인덱스. 실제 추가 인덱스는 EXPLAIN으로 결정한다.
- RLS: 인증된 소유자 SELECT. 클라이언트의 AI 컬럼 직접 변경 금지. 서버 전용 AI 저장과 소유자 전용 override RPC 분리.
- AI 저장은 AI 영역만 변경한다. override RPC는 auth.uid()로 소유자를 확정하고 사용자 영역만 원자 갱신한다. 동시 재분석에서도 사용자 값이 보존되어야 한다.

기존 ITEM / Classification 컬럼·enum·사용자 override 계약은 유지한다. 새 테이블·검증 제약·RLS/권한·저장/조회 함수 변경에는 Migration이 필요하다. 적용 전 별도 검토한다.

## 4. 광고 전용 user_override

일반적인 show/hide 기능이 아니다. 광고 판정에 대한 사용자 수정만 제공한다.

- null: AI 자동판단과 현재 보호 정책으로 복귀.
- force_show: 사용자가 일반/중요 자료로 판단 → 기본 SHOW.
- force_promotional: 사용자가 광고/홍보로 판단 → 기본 HIDE.

UI 문구: ‘일반/중요 자료로 지정’, ‘광고/홍보로 지정’, ‘AI 자동판단으로 복귀’.
Topic / Tags / Document Type 수정은 noise override와 무관하다. AI 재분석은 user_override를 변경하지 않는다.

force_promotional은 보호 조건보다 우선하는 명시적 사용자 광고 판단이다. 이 경우에도 Action / Deadline / Event 자체는 삭제·무효화하지 않고 할 일·D-Day·Calendar에서 유지한다. 소유자의 원본·Detail 접근도 유지한다.

## 5. AI 판정과 서버 표시 정책 분리

- ai_verdict: 독립 광고 판정. 미판정은 null.
- user_override: 사용자 광고 판정 수정.
- protection_state: 현재 연결 데이터·검증된 중요 신호·불확실성의 보호 사유 목록.
- effective_visibility: 기본 목록에서 SHOW / HIDE.

우선순위:

1. user_override=force_show → SHOW.
2. user_override=force_promotional → HIDE. Action / Deadline / Event는 유지.
3. 보호 조건 존재 → SHOW.
4. 유효한 ai_verdict=promotional + 검증된 광고 Evidence → HIDE.
5. ai_verdict=normal / uncertain / null 또는 나머지 상태 → SHOW.

protection_state 사유:

- action_exists: action_sources로 연결된 Action. 완료·과거 Source 이력 포함.
- deadline_exists: 연결된 확정 Deadline 또는 날짜 확인 필요 Deadline 관찰값.
- event_exists: Google Calendar ITEM 또는 AI Event. 날짜 확인 필요 Event 포함.
- payment / billing / contract / security / account / service_outage: 결제·청구·계약·보안·계정·장애 중요 안내.
- personal_obligation / uncertain_relationship: 개인 의무·응답·참석 요구 또는 중요 개인 관계 여부 불명확.
- assessment_unavailable / assessment_stale / analysis_incomplete / invalid_evidence / protection_check_unavailable: 미판정, 오래된 입력, 분석 미완료·실패, 근거 검증 실패, 보호 정보 확인 실패.

중요 신호를 기존 documentType만으로 추정하지 않는다. 원문 문맥과 검증된 protectionSignals를 사용하며, Action / Deadline / Event는 현재 소유자 데이터로 검사한다. 중요 안내가 섞인 광고는 promotional 판정을 유지하면서 SHOW한다.

예: ‘10월 24일 백화점 할인 행사’ → ai_verdict=promotional, Event 존재, protection_state=[event_exists], effective_visibility=SHOW.

## 6. 광고 포함 및 API

- Library/Home 조회와 Search filters에 includePromotional boolean, 기본 false.
- OFF: effective_visibility=SHOW인 자료만 포함. 보호 조건이 없는 자동 promotional 및 force_promotional 자료 제외.
- ON: HIDE 자료도 기존 검색어·출처·기간 등에 맞으면 포함. force_show는 OFF/ON 모두 표시 대상.
- 토글은 AI 판정·override·데이터를 변경하지 않는다.
- Library / Home / Search는 동일 서버 정책 사용. Home은 정책 적용 후 최근 3개 선택.
- Library 페이지 제한·집계·커서 생성 전에 적용. 클라이언트 사후 제거 금지.
- Search 키워드·벡터 후보 선정과 후보 수 제한 전에 적용. 관련 자료 추천도 같은 ITEM 정책 사용.
- Action 검색 및 Home 할 일/Calendar는 ITEM 광고 필터 때문에 Action / Deadline / Event 또는 필수 Source Evidence를 누락하지 않는다. 숨김 ITEM의 Evidence 접근은 소유자에게 유지한다.
- Detail projection: aiVerdict, confidence, evidence, reasons, userOverride, protectionState, effectiveVisibility, assessmentVersion. 판정과 표시를 혼동하는 effectiveVerdict는 사용하지 않는다.
- 별도 PATCH noise-override는 userOverride=null/force_show/force_promotional만 허용. 인증·소유권·origin/CSRF·입력 검증·no-store 적용. 기존 Classification PATCH 유지.

## 7. 커서·Search snapshot

includePromotional과 표시 정책 버전을 queryKey / cursor context / Search snapshot context에 포함한다. 토글 변경 시 첫 페이지부터 다시 조회하며 기존 cursor/search snapshot 재사용을 금지한다.

검색어 Embedding 캐시는 결과 snapshot과 별개다. includePromotional만 바뀌면 모델 입력이 같으므로 기존 query Embedding 캐시를 재사용한다. 토글을 이유로 새 Embedding을 생성하지 않는다.

현재 Search snapshot은 ITEM updated_at을 확인하지만 독립 assessment 변경만으로 무효화되지 않는다. AI 판정·override·보호 상태 변경 시 해당 소유자의 기존 Search 결과 snapshot을 같은 저장 트랜잭션에서 무효화한다. 최소안은 추가 revision 테이블 없이 기존 private.search_sessions를 소유자 범위로 무효화하는 것이다. 다음 요청은 재검색하고 만료 커서를 다른 필터로 재해석하지 않는다.

Action / Source / Deadline / Event 변경과 원문 갱신으로 assessment가 stale이 된 경우도 무효화 대상이다. TTL 만료까지 기다리지 않는다. 이는 결과 snapshot 변경이며 Embedding·검색 인덱스 재생성이 아니다.

## 8. 기존 자료와 비용

- assessment 없는 기존 ITEM은 SHOW. 사용자 수정이 먼저 있으면 override 우선.
- 신규/명시적 재분석 ITEM부터 적용. 출시 시 전체 과거 ITEM Gemini 재분석 금지.
- backfill 필수 아님. 별도 승인 사항.
- Gemini 추가 호출: NO. 기존 분석 1회 structured output만 확장. 출력 토큰·검증 비용은 늘 수 있으므로 호출 수 불변이 총비용 완전 불변을 뜻하지는 않는다.
- 토글 / Library / Home / Search 조회에서 광고 판별 Gemini 호출: NO. 기존 semantic Search query Embedding 정책은 유지하며 광고 때문에 추가 호출하지 않는다.
- Embedding 재생성: NO. assessment/override 변경은 ITEM 원문·Embedding 입력을 변경하지 않는다.
- DB/query: assessment 조인, Action 보호 EXISTS, 기존 JSON Event 존재 검사, 소유자 Search snapshot 무효화 비용 추가. 조회 시 상세 reader N+1 또는 Gemini 호출 금지. 실행계획·페이지 정합성 검증 필요.

## 9. 필수 설계 검증 A~H

- A. ‘10월 카드 결제 예정금액 안내’: AI normal, 결제/청구 보호, SHOW.
- B. ‘신한카드 고객님 10% 캐시백 이벤트’: AI promotional, Protection none, HIDE. 실제 Event/Action/Deadline·중요 알림이 있으면 보호 우선.
- C. ‘10월 24일 채용박람회 참가 안내’: AI promotional 가능, Event 존재 → event_exists, SHOW.
- D. ‘계약 갱신 안내 — 10월 30일까지 확인’: Action/Deadline 및 계약 보호 → SHOW. AI 판정과 독립.
- E. ‘신제품 출시 50% 할인’: AI promotional, 보호 없음, HIDE.
- F. ‘보안 정책 변경 안내’: 중요 보안 보호 → SHOW. AI 판정과 독립.
- G. AI promotional + force_show → SHOW.
- H. AI normal + force_promotional → HIDE.

override가 명시되지 않은 사례는 null을 전제로 한다. ‘이벤트’라는 단어만으로 Event를 만들지 않으며 실제 Event가 추출되면 광고 여부와 무관하게 보호한다.

추가 회귀: 미분석/v0.2/실패/stale 표시, 유효 Evidence 필수, 혼합 중요 안내 보호, override 재분석·동시성 보존, OFF/ON 복원, 후보 제한 이전 필터, Home 최근 목록 수, cursor context 불일치, snapshot 즉시 무효화, force_promotional 자료의 Action/Calendar 유지, 타 소유자 접근 차단, 원본 삭제 없음, 추가 Gemini·Embedding 호출 없음.

## 10. 구현 순서와 적용 경계

1. 이 계약 기준 Migration/RLS/RPC 및 v0.3 schema 변경안을 리뷰한다. 읽기 호환성·호출 수·보호/override 테스트 준비. 운영 Migration 적용은 별도 승인 전 수행하지 않는다.
2. v0.2/v0.3 reader, 단일 Gemini 출력 확장, 원자 저장, 독립 override 및 snapshot 무효화를 구현한다. 자동 숨김 OFF 상태에서 검증한다.
3. Library / Home / Search 공통 정책과 광고 포함을 연결하고 A~H·회귀·성능 검증 후 제한적으로 활성화한다. backfill은 별도 승인.

후속 승인 단계: LOCAL IMPLEMENTATION / ISOLATED DEV DB VALIDATION / PRODUCTION DB CHANGE NO / COMMIT NO / PUSH NO / DEPLOY NO.

## 자동배포 readiness gate 보완 (2026-10-12)

서버 PROMOTIONAL_NOISE_ENABLED의 기본값은 false다. true와 DB capability/REST cache 검증이 모두 충족될 때만 새 기능을 사용한다. OFF/DB-not-ready는 기존 query 및 Gemini v0.2 계약을 사용하며, v0.3 저장 데이터의 Classification/Action/Event 읽기는 유지한다.

기존 search_candidates/search_similar는 보존하고 ON용 별도 RPC를 추가한다. 표시 정책 변경은 promotionalEnabled=true로 생성된 snapshot만 무효화하며 legacy snapshot은 유지한다. 모드가 달라진 커서는 410 재검색으로 처리한다. Library/Search 계약 누락 race는 한 번만 legacy fallback한다. 준비 확인에 실패한 override는 404로 비활성 처리하며 새 override RPC를 호출하지 않는다.

아직 미적용인 migration 파일에 readiness RPC와 분리 검색 RPC를 반영한다. 운영 DB 변경·Commit·Push·Deploy는 이번 단계에서 수행하지 않는다. 운영 복구의 일차 수단은 flag OFF이며 구버전 코드로의 롤백은 별도 호환성 경계다.
