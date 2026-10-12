# 광고/홍보 노이즈 제거 로컬 구현 검증

RESULT: REVIEW_REQUIRED

코드·Migration 작성 및 격리 개발 PostgreSQL 회귀는 완료했다. 실제 Gemini는 GEMINI_UNAVAILABLE(HTTP 응답 없음)이며, 운영과 분리된 Supabase Auth/PostgREST 환경에서의 통합 smoke는 남아 있다. 이 상태를 Production 준비 완료로 해석하지 않는다.

## DB 및 적용 경계

- 기준 HEAD: bfe7f5f. Commit/Push/Deploy/Notion 수정 없음. README의 기존 미커밋 124행 변경은 손대지 않았다.
- Migration: supabase/migrations/20261012110525_promotional_noise_contract.sql. Supabase CLI로 생성했다.
- dev applied: YES, 격리 PGlite PostgreSQL 17.5 + pgvector의 합성 owner/ITEM 데이터에 baseline·기존 관련 migration·신규 migration을 적용하고 종료 시 메모리 DB를 폐기했다.
- ai-hub-dev 원격 적용: NO. 프로젝트 이름과 달리 현재 운영에 연결된 동일 DB이므로 적용하지 않았다.
- 운영 읽기 전용 확인: item_noise_assessments 없음, item_is_visible 함수 없음. Production DDL/데이터 변경 없음.
- 소유자 SELECT RLS, 비소유자 조회/override 거절, authenticated AI DML 불가, anon RPC 불가, 복합 FK 소유권 검증 PASS.

## 코드 감사 및 구현

- AI: AI_OUTPUT_SCHEMA.json / src/lib/gemini/client.ts / validation.ts / src/types/analysis.ts. v0.3에서 기존 필드 의미 유지 + noiseAssessment. v0.2 저장 결과 읽기 호환. 새로운 provider 응답은 v0.3 필수.
- 저장: src/lib/items/analysis.ts / analysis-policy.ts. 기존 v0.2 저장 함수 본문을 private에 그대로 보존하고 공개 RPC에서 v0.3 noise를 같은 트랜잭션으로 저장한다. 기존 Classification/Action 매칭/완료 상태/Evidence 구현을 교체하지 않는다.
- Evidence: 동일 원문 인용/Unicode locator 검증 재사용, promotional 근거와 이유 일관성 필수. DB에서도 근거·소유권·fingerprint 검사. 잘못된 근거/실패/stale은 자동 숨김하지 않는다.
- Visibility: public.item_is_visible 공통 predicate. Detail state도 이 함수를 사용한다. AI verdict와 표시 결정을 분리하며 Action 이력, Deadline, Google/AI/needs_review Event 및 검증된 중요 안내 보호.
- Override: 독립 소유자 GET/PATCH noise-override. force_show / force_promotional / null. AI 재분석은 사용자 컬럼을 변경하지 않으며 기존 Topic/Tags override도 보존한다.
- Library/Home: DB predicate 후 cursor/limit, Home 최근 3개. 광고 포함 토글.
- Calendar/Actions: 사용자 force_promotional 자료도 연결 Action/Deadline/Event 유지. Calendar 자료 조회는 includePromotional=true.
- Search: 기존 SQL 후보의 document eligibility에만 predicate 삽입. RRF/keyword/vector/ranking 및 search_index 본문은 유지됨을 검증했다. 커서 context 분리, 변경 시 소유자 snapshot 무효화, 동시 변경 결과 재검사, 만료는 410.
- 비용: 광고 전용 Gemini 호출 0. 기존 분석 응답만 확장. 광고 토글은 동일 검색어 Embedding 캐시 재사용. 문서 Embedding 재생성 없음. 응답 토큰 증가는 가능.
- Backfill 없음. 수집 orchestration은 유효한 v0.2 분석도 current로 인식하여 출시 시 일괄 재분석하지 않는다.

## 테스트

- npm test: 227 PASS / 0 FAIL / 0 SKIP. 기준 200보다 증가.
- npm run typecheck: PASS.
- npm run lint: PASS.
- npm run build: PASS.
- git diff --check: PASS. 신규 파일 whitespace 검사도 PASS.
- A/B/C/D/E/F/G/H: 모두 PASS.
- 추가: stale/invalid Evidence, 분석 실패, v0.2, override 재분석 보존, Event 추가/제거, Action 이력, 원본/일정 유지, 후보 제한 이전 필터, cursor 및 snapshot 무효화, 타 사용자 접근 거절, 검색어 Embedding 재사용 PASS.
- Manual: 단일 분석의 10월 24일 코딩테스트 → 2026-10-24 Event, Action 0 회귀 PASS.
- 기능 smoke는 기존 Auth/Login/Settings/Google OAuth·Sync/Storage/Upload/OCR·API 격리 회귀 및 Home/Library/Search/Detail/Actions/Calendar SSR 기준이다. 외부 Google 재동기화·실제 사용자 로그인·실제 새 Upload/OCR/Gemini end-to-end를 완료했다고 주장하지 않는다.
- 실제 Gemini smoke: 합성 Manual 입력을 기존 분석 경로로 호출했지만 GEMINI_UNAVAILABLE. DB 쓰기 없음. 노이즈 전용 추가 호출 없음. 외부 오류를 이유로 모델/정책을 변경하지 않았다.

## Query 실측

합성 owner ITEM 115개, 격리 PostgreSQL/WASM EXPLAIN ANALYZE 결과다. 운영 지연/SLA 예측값이 아니다. 전체 plan: supabase/.temp/noise-performance.json(재실행 시 갱신).

- Library: 광고 포함 ON 0.504ms / 기본 OFF 15.571ms. 기존 items_user_created_at_idx 사용.
- Home: 광고 포함 ON 0.053ms / 기본 OFF 11.76ms. 기존 items_user_created_at_idx 사용.
- Search: 광고 포함 ON 22.115ms / 기본 OFF 12.682ms. 내부 후보 SQL까지 EXPLAIN. 기존 ITEM/Chunk/Job 인덱스 사용, 사용자 범위 후보에 predicate가 적용됨.
- 기본 필터의 추가 검사 비용은 존재한다. 조회용 경량 boolean 함수로 Detail JSON 생성 비용을 피했다. 대규모 실제 데이터 성능은 별도 검증이 필요하다.
- 추가 인덱스는 assessment 소유자/판정 인덱스 1개와 ITEM PK뿐이다. 동적 보호 조건을 잘못 immutable index로 고정하지 않는다.

## 이번 작업 변경 파일

- AI_OUTPUT_SCHEMA.json
- docs/SPEC.md
- docs/ai/AI_OUTPUT_SPEC.md
- package-lock.json
- package.json
- scripts/content-ui-loader.mjs
- scripts/test-analysis.mjs
- scripts/test-content-ux-calendar.mjs
- scripts/test-drive.mjs
- scripts/test-gap.mjs
- scripts/test-gmail.mjs
- scripts/type-tests/item-detail-contract.ts
- src/app/items/[itemId]/page.tsx
- src/app/page.tsx
- src/components/actions/use-workspace-data.ts
- src/components/home/today-view.tsx
- src/components/library/library-toolbar.tsx
- src/components/search/search-workspace.tsx
- src/lib/gemini/client.ts
- src/lib/gemini/validation.ts
- src/lib/items/analysis-policy.ts
- src/lib/items/analysis.ts
- src/lib/items/filters.ts
- src/lib/items/queries.ts
- src/lib/search/contract.ts
- src/lib/search/service.ts
- src/types/analysis.ts
- supabase/migrations/20261012110525_promotional_noise_contract.sql
- src/lib/items/noise.ts
- src/components/items/noise-controls.tsx
- src/app/api/v1/items/[itemId]/noise-override/route.ts
- scripts/noise-db.mjs
- scripts/test-promotional.mjs
- scripts/test-promotional-contract.mjs
- scripts/check-promotional-live.mjs
- docs/reviews/PROMOTIONAL_NOISE_DESIGN.md
- docs/reviews/PROMOTIONAL_IMPLEMENTATION_REPORT.md (이 보고서)

Migration CREATED / Production applied NO / Commit NO / Push NO / Deploy NO.
