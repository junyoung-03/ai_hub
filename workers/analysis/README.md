# 현재 실행 방향: 무료 시연 경로

사용자 후속 요청으로 Cloud Run 배포는 보류한다. 현재 준비한 경로는 Supabase Cron → 기존 Vercel Node handler이며, 승인된 테스트 소유자 1명/메일 최대 3건/호출당 1건/자체 하루 5회 예산이다. 실제 migration/Cron/배포는 아직 하지 않았다. 실행 전 검토: `docs/reviews/GMAIL_FREE_DEMO_REVIEW_20261013.md`.

아래 Cloud Run 내용은 이전 경로의 보관 문서이며 현재 실행 지침이 아니다.

---

# Gmail 분석 Worker — 적용/배포 승인 대기

새 분류 schema나 Prompt를 만들지 않는다. `src/lib/gemini/client.ts`와 validator를 그대로 실행하고,
검증된 결과는 작업 토큰을 검사하는 DB 함수 안에서 기존 `persist_gmail_item_analysis`로 저장한다.
기존 UI의 소유자 인증 API는 유지한다. Worker는 브라우저 쿠키를 전달받거나 사용자 API 인증을 우회하지 않는다.

## 현재 상태

- Migration `supabase/migrations/20261013030716_gmail_analysis_worker_queue.sql`: 로컬 PostgreSQL 검증, 실제 적용 안 함.
- 앱 flag 기본 OFF. Worker/Scheduler 미배포. 기존 UI의 한 작업 최대 3건 분석은 OFF에서 유지.
- 현재 확인한 `ai-hub-dev-510512`는 billingEnabled=False, Cloud Run API=SERVICE_DISABLED.
  이번 작업에서 API 활성화, billing/IAM/Secret/클라우드 리소스 변경을 하지 않았다.
- 실제 테스트 계정의 Gmail 집계: queued 18, GEMINI_UNAVAILABLE 7, ANALYSIS_VALIDATION_FAILED 1.
  이것은 기존 상태 읽기이며 새 Worker의 실행 결과가 아니다.

## 실행/보안 계약

- Cloud Run private IAM service, 인증 필수. allUsers/allAuthenticatedUsers 권한 금지.
- 입력 없는 `POST /run`만 허용. 요청 본문/user_id/ITEM id로 작업 범위를 바꾸지 않는다.
- 실행 계정은 별도 service account, invoker는 Scheduler용 service account로 제한.
- `GMAIL_ANALYSIS_ALLOWED_USERS`에 승인된 Auth UUID를 명시한다. 처음에는 테스트 계정 1개만 등록.
  앱과 Worker에 같은 allowlist/flag/model을 설정한다. allowlist 밖의 앱 사용자는 기존 동기 분석을 유지한다.
- `GMAIL_ANALYSIS_WORKER_ENABLED=true`와 Supabase server credential, Gemini key/model이 필요하다.
  Secret Manager로 주입하고 이미지/저장소/커맨드 인자에 secret 값을 넣지 않는다.
- `PROMOTIONAL_NOISE_ENABLED`는 false 또는 unset. Worker는 true면 중단한다. 기존 0.2 출력 계약 유지.
- 각 호출은 최대 3건·약 240초의 bounded loop. 호출 종료 뒤 떠 있는 Promise로 후속 처리하지 않는다.
- Cloud Scheduler가 1분 간격 OIDC로 `/run`을 호출한다. 다음 호출이 남은/재시도 가능한 작업을 읽는다.
  Cloud Run timeout=300s, concurrency=1, max-instances=1, min-instances=0부터 테스트.
- Supabase 요청 15초, 기존 Gemini 총 budget 80초. 작업 lease는 180초.
- 처리 중 프로세스가 죽으면 만료 lease를 새 토큰으로 회수한다. 이전 토큰/기간이 지난 토큰은 저장 불가.
- HTTP 429/500/502/503/504·네트워크·타임아웃·불완전 출력·저장 일시 오류만 지연 재시도.
  60초부터 지수 증가, provider Retry-After 반영(최대 하루), 총 5회. 인증/설정/검증/DB 제약 거절은 자동 무한 재시도 안 함.
- source text 변경만 작업을 다시 등록한다. status/metadata 변경이나 동일 본문 재수집은 재등록하지 않는다.
- user → ITEM → job 순서 잠금, 저장 직전 토큰/lease/ITEM snapshot 검사.
  기존 RPC가 Action/Source/Evidence 중복 방지와 user_* 보호를 담당한다.
- 작업 상태는 private 테이블. browser direct read/write 불가. authenticated는 자기 ITEM enqueue만 가능.
  service_role도 테이블 직접 접근 없이 제한된 claim/finish RPC를 사용한다.
- 기존 index/search queue와 독립. 분석 성공의 indexing 상태를 검색 색인 완료라고 표시하지 않는다.

## DB 변경 검토 항목

신규 private.gmail_analysis_jobs 1개, due index 1개, 신규 Gmail 본문 변경 trigger 1개,
public enqueue/claim/finish 함수 3개와 내부 trigger 함수 1개를 추가한다.
기존 테이블 column/enum, 기존 분석 저장 RPC, RLS policy, Evidence/Source/Google 원본은 변경하지 않는다.
Migration 자체는 기존 메일을 일괄 등록하거나 Gemini를 호출하지 않는다.

## 빌드/검증

```
npm run build:analysis-worker
node --test tests/test-analysis-worker.mjs
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Docker build는 저장소 root context에서 `workers/analysis/Dockerfile`을 사용한다.
Dockerfile의 COPY allowlist만 전달되며 `.env`, 메일, 테스트 자료는 이미지로 복사하지 않는다.
런타임은 `.analysis-worker/workers/analysis/server.cjs`를 `node --conditions=react-server`로 실행한다.
공유 server-only module을 Node 서버에서 실행하기 위한 조건이며 browser bundle에는 포함하지 않는다.

## 승인 후 적용 순서 — 이번 작업에서는 미실행

1. 사용자가 정확한 migration 내용을 승인한 뒤 연결 DB에 해당 파일만 적용한다. 다른 pending migration을 함께 push하지 않는다.
2. 테스트 프로젝트 billing은 사용자가 연결한다. 필요한 Cloud Run/Build/Artifact Registry/Scheduler/Secret Manager/IAM API와 최소 권한을 검토한다.
3. 테스트 계정 UUID `c05fdc30-bf78-4922-b2bb-af576b3af270`만 allowlist에 넣고 private Worker를 배포한다.
4. 승인된 앱 배포에서 해당 계정만 worker flag를 켠다. Worker readiness/privilege 실패는 503이며 브라우저 동기 분석으로 몰래 fallback하지 않는다.
5. 기존 테스트 계정 backlog는 별도 명시적 승인 후 등록한다. 기본 dry run:
   `node --env-file=.env.local scripts/enqueue-gmail-analysis.mjs --user=<승인된-UUID>`
   출력은 집계와 다음 cursor뿐이다. 검토 후 `--apply`로 최대 100건 등록한다.
   `nextAfter`가 있으면 `--after=<cursor>`로 다음 페이지를 처리한다. 다른 사용자 전체 backfill은 금지한다.
6. Scheduler OIDC audience=Worker service URL, invoker=전용 service account, body 없음으로 설정한다.
7. 실제 Google 로그인한 테스트 계정에서 Gmail sync→ITEM→Worker→Gemini→DB Event→Home refresh를 확인한다.
   대기 감소/실패별 상태/프로세스 중단 복구/중복 Action·Event/사용자 수정 보호를 별도로 기록한다.
8. 실제 Google/Cloud/Gemini 실행이 없으면 E2E PASS라 보고하지 않는다.

## Rollback

Scheduler pause, 앱 flag OFF, Worker traffic 중단. 작업 기록과 기존 저장 결과는 보존한다.
새 private 작업 테이블을 지우거나 기존 자료를 삭제할 필요가 없다.
Migration 적용 자체와 rollback DDL도 사용자 확인 후 실행한다.

공식 실행 방식 참고: [Cloud Scheduler → 인증된 Cloud Run](https://docs.cloud.google.com/run/docs/triggering/using-scheduler).
