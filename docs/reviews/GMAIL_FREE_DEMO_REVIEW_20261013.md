# 무료 Gemini Gmail 시연 검토

후속 사용자 승인으로 DB migration/스케줄러 지원 함수까지 적용했다. 최신 실제 적용·배포 상태는 `GMAIL_FREE_DEMO_DEPLOY_20261013.md`를 따른다. 아래는 승인 전 검토 기록이다.

RESULT: REVIEW_REQUIRED. 실제 메일 2건 분석/분류/저장 확인. 자동 처리 migration/Cron/운영 배포 미적용.

- 실제 키 프로젝트 결제 비활성 확인. 유료 전환/Cloud Run 활성화 없음.
- 기존 모델: 무료 일일 요청 quota 20 소진, HTTP 429. Gemini 3.6 Flash 시험: HTTP 503.
- 무료 Flash-Lite 모델로 2건 실제 분석/분류/Action/Evidence 저장. 한 건의 제출 날짜 2026-10-18.
- 세 번째 승인 메일은 REQUIREMENTS 원문 인용 검증 실패. 성공으로 계산하지 않음.
- 성공한 제출 메일을 별도 요청으로 재조회/재분석: providerCalls=0, 같은 저장 결과 재사용.
- 실제 브라우저는 다른 계정으로 로그인되어 있어 테스트 계정 Library/Planner/Home 화면은 NOT TESTABLE. 서버/DB 검증을 브라우저 PASS로 보고하지 않음.
- 테스트 메일의 원문/AI 원문/비밀번호/API 키는 보고서 및 로그에 저장하지 않음.

## 코드 준비

Vercel Node POST `/api/internal/gmail-analysis` → 기존 worker runner → 기존 Gemini/validator → 기존 원자 저장 RPC.
독립 32자 이상 Bearer secret, 서버 owner 1명/ITEM 최대 3개 allowlist, 한 번에 한 건, 요청 body 금지, default OFF.
무료 모드는 생성 요청 1회. 429 재시도는 최소 1시간 또는 더 긴 Retry-After. 예산은 인스턴스 메모리가 아닌 DB에 보관.
Gemini 기존 날짜/인용 규칙 명확화와 locator transport 제한만 수정. 스키마/분류 체계/저장 RPC는 그대로.
Cloud Run server/container는 보류한 경로로 남아 있으며 배포하지 않음.

## 적용 전 검토할 migration

`supabase/migrations/20261013030716_gmail_analysis_worker_queue.sql`

추가:
- private.gmail_analysis_jobs + due index + Gmail 본문 변경 enqueue trigger
- owner-scoped enqueue, service-only claim/finish RPC
- private.gmail_free_budget + service-only claim_free_gmail_analysis_job

기존 사용자 데이터/column/enum/RLS/원자 저장 RPC 변경 및 과거 일괄 backfill 없음.
작업 최대 5회, lease 180초, token/본문 revision/updated_at fencing.
무료 예약 예산: 프로젝트 전체 UTC 날짜당 5회, 최소 60초 간격. 실패/캐시/중단 예약도 소비. 공급자의 quota는 별도이며 먼저 제한될 수 있음.
직접 테이블 접근은 browser/service_role 모두 금지. authenticated는 본인 ITEM enqueue만 가능.
실제 DB에는 적용하지 않았음. 로컬 PostgreSQL 테스트로 검증.

## 승인 후 배치 순서

1. migration 검토/승인 후 적용, 실제 grants/ownership/readiness 검증.
2. 현재 무료 키와 실제 모델 quota 확인. 운영 모델은 아직 변경하지 않음.
3. Vercel duration 120초 지원 확인. secret/owner/ITEM IDs를 서버 환경에만 설정. worker flag는 준비 완료까지 OFF.
4. Supabase pg_cron/pg_net/Vault 가용성/무료 사용량 확인. 확장/secret/schedule은 별도 승인 전에 생성하지 않음.
5. Vault에 호출 URL과 독립 Bearer secret을 저장. secret 값은 SQL 파일/로그에 넣지 않음.
6. 2분 간격 Cron POST로 호출. 성공 또는 당일 예산 소진 후 시연 작업을 중지. 상시 빈 호출을 유지하지 않음.
7. 테스트 계정으로 실제 Library/Detail/Planner/Home 확인 및 새로고침, screenshot 확보.

Cron 설정 형태(검토 템플릿, 실행하지 않음):

```sql
select cron.schedule('etc-gmail-demo', '*/2 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='etc_gmail_analysis_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='etc_gmail_analysis_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
-- 시연 종료 후: select cron.unschedule('etc-gmail-demo');
```

운영 적용 전 pg_net 요청/응답 및 Vercel 응답 상태를 검증해야 한다. Cron HTTP 전송 성공을 분석 성공으로 간주하지 않는다.

운영자 수동 검증 도구 `scripts/demo-gmail-analysis.mjs`는 명시적 owner/최대 3 IDs/Free Tier 확인 flag를 요구하며 default dry-run이다. 기존 서버/DB 경로 검증용이고 브라우저 인증 검증을 대체하지 않는다.

AI Library Classification: NOT STARTED. Promotional: OFF.
Migration apply / Commit / Push / Deploy: NO.

## 검증 결과

- npm test: 294/294 PASS (이전 288 이상 유지)
- typecheck / lint / build / git diff --check: PASS
- queue SQL: 로컬 실제 PostgreSQL에서 lease/retry/ownership/중복/사용자 수정값 보호 및 무료 예산 검증
- protected Vercel handler: 무인증 거부, 클라이언트 scope 확장 거부, 한 건 동기 실행 테스트
- 실제 공급자: 429 quota/RetryInfo, 503, Flash-Lite 분석 및 검증 실패를 구분
- 실제 저장: 승인 메일 2건의 Classification/Action/Source/Evidence DB 재조회
- 성공 자료 재실행: Gemini 호출 0, 동일 저장 결과
- 테스트 계정의 실제 브라우저/Home 표시 및 새 예약 경로 원격 실행: NOT TESTABLE / 미적용

로그: `docs/reviews/pre-classification/free-demo-{tests,typecheck,lint,build}.log`.
