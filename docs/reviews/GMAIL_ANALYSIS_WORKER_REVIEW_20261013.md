# Gmail 대기 분석 Worker 구현 검토

후속 사용자 요청으로 무료 Supabase Cron → Vercel 경로를 준비했다. 이 문서의 Cloud Run 배포 계획과 Prompt 변경 없음 문구는 당시 기록이다. 현재 변경/실제 검증/적용 전제는 `GMAIL_FREE_DEMO_REVIEW_20261013.md`를 따른다.

RESULT: REVIEW_REQUIRED — 로컬 구현/검증 완료, 실제 DB/Cloud 적용 대기.

## 구현

- 기존 `analyzeGmailText`, validator, analysis fingerprint를 그대로 공유한다. Prompt/AI schema/taxonomy 변경 없음.
- 신규 private Gmail 작업 상태 + enqueue/claim/finish RPC. 기존 `persist_gmail_item_analysis`를 토큰/lease/ITEM snapshot 검증 뒤 같은 DB transaction에서 호출한다.
- 소유자별 명시적 allowlist + 기본 OFF flag. 해당 계정의 기존 분석 API는 202로 큐 요청을 반환하고 UI는 완료라고 표시하지 않는다.
- Cloud Run private service의 `/run`은 입력 없는 호출만 허용하며, 요청이 끝난 후 detached 작업을 남기지 않는다. Scheduler의 다음 OIDC 호출로 작업을 이어간다.
- 작업당 180초 lease, 최대 5회, 지수 backoff 및 Retry-After(최대 하루). 만료 작업 회수·이전 토큰 저장 차단·일시 오류 후속 처리.
- Gemini HTTP 상태/타임아웃/네트워크/불완전 출력/응답 검증/저장 제약 거절을 안전한 코드로 구분한다. 원문/provider 응답/secret은 오류 로그에 포함하지 않는다.
- 최초 migration에는 과거 메일 일괄 등록이 없다. 별도 owner-scoped 도구는 기본 dry run, 명시적 `--apply`만 등록하며 이미 분석된 동일 본문/모델은 건너뛴다.
- 기존 ITEM 원문/Google 원본/Evidence/Source/사용자 분류 override는 변경하지 않는다. 기존 저장 RPC의 중복 방지와 user_* 보호를 유지한다.

## 적용 전에 검토할 DB 변경

파일: `supabase/migrations/20261013030716_gmail_analysis_worker_queue.sql`

추가: private.gmail_analysis_jobs, due index, Gmail 본문 insert/update trigger, 내부 trigger 함수,
public.enqueue_gmail_analysis / claim_gmail_analysis_job / finish_gmail_analysis_job.

기존 column/enum/저장 RPC/사용자 RLS 변경 없음. private 테이블은 browser와 service_role 모두 직접 접근 불가.
authenticated는 본인 ITEM enqueue만, service_role은 제한된 worker RPC 실행만 허용한다.

오래된 작업 결과의 저장을 막기 위해 finish RPC에서 token·lease·본문 revision·updated_at을 검사한다.
동일 결과 재저장은 기존 RPC의 no-op로 처리하며 Action/Source/Evidence가 늘어나지 않음을 실제 로컬 PostgreSQL에서 확인했다.
RPC의 cache no-op 후에도 ITEM이 analyzing에 남지 않도록 상태를 마무리한다.

실제 DB 적용은 수행하지 않았다. 승인 시 다른 pending migration을 포함하는 전체 db push 대신 해당 migration만 적용해야 한다.

## 검증 결과

- npm test: PASS 288/288 (기존 271 유지, 신규 Worker 관련 17).
- Worker SQL: PASS. 실제 baseline 및 기존 분석 저장 RPC를 올린 격리 PGlite/PostgreSQL에서 실행.
- 검증: owner 제한, browser/anon 권한 거부, service RPC 권한, 중복 claim/finish, lease 중단 복구,
  지연 retry, 다섯 번 중단 후 종료, 원문/metadata 변경 시 stale 결과 차단, Source/Evidence ID 유지,
  User Edited 유지, Event 저장, Action 중복 없음, cached no-op 이후 처리 상태.
- compiled Worker HTTP entrypoint: PASS. 실제 Node 프로세스 시작·404·본문 거부·owner scope 없을 때 fail closed.
  합성 환경만 사용했고 외부 Gemini/DB에 연결하지 않았다.
- npm run build:analysis-worker / typecheck / lint / build / git diff --check: PASS.
- Docker image build / 실제 Cloud Run IAM·Scheduler 실행: NOT TESTABLE. 로컬 Node 실행을 클라우드 검증으로 대체하지 않는다.

## 실제 계정/클라우드 상태 (읽기만 수행)

테스트 계정 Auth UUID: c05fdc30-bf78-4922-b2bb-af576b3af270.
Gmail: queued 18, GEMINI_UNAVAILABLE 7, ANALYSIS_VALIDATION_FAILED 1.
원문/메일 본문은 이 확인에 필요하지 않아 읽지 않았다. 아직 이 자료를 새 큐에 등록하지 않았다.

저장소 배포 설정의 GCP project ai-hub-dev-510512 / asia-northeast3:
Cloud Run 서비스 목록 조회는 SERVICE_DISABLED로 실패했고, billingEnabled=False를 확인했다.
API 활성화/billing 연결/IAM 변경/Secret 생성/Cloud Run 또는 Scheduler 생성은 수행하지 않았다.

현재 브라우저 테스트 계정 전환은 Google 계정 관리 origin 접근에 대한 별도 자동 승인 검토 제한이 남아 있다.
이를 우회하지 않았으며 새 Worker를 통한 실제 Gmail→Gemini→DB→Home 흐름은 실행하지 않았다.

실제 사용자 E2E: NOT TESTABLE / 미완료. 단위/SQL 테스트 통과로 실제 대기 해소나 provider 회복을 주장하지 않는다.
응답 검증 실패는 자동 무한 재시도하지 않으며, 기존 1건이 이 변경으로 복구되었다고 주장하지 않는다.

## 다음 승인/설정 단계

1. 검토한 migration 파일의 실제 DB 적용 승인.
2. 사용자의 GCP billing 연결 및 필요한 API/IAM/Secret/Private Cloud Run/Scheduler 구성 승인.
3. 테스트 계정만 allowlist에 등록한 앱/Worker 배포 및 해당 계정 backlog 처리 승인.
4. 실제 E2E 확인 후 별도 최종 결과 보고. 그 전 전체 사용자 backfill이나 rollout 금지.

실행/rollback 절차: `workers/analysis/README.md`.

AI Library Classification: NOT STARTED

Promotional: OFF

DB migration applied: NO

Commit: NO

Push: NO

Deploy: NO
