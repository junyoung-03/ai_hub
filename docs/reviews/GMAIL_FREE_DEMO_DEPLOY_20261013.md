# 무료 Gmail 시연 배포 기록

사용자 승인: DB 적용, 한국어 커밋, push, Production 배포 및 테스트 계정 화면 확인.

## DB 적용

- gmail_analysis_worker_queue: 작업 큐/무료 예산/RPC 적용 성공
- gmail_free_cron_extensions: pg_cron/pg_net 적용 성공
- gmail_scheduler_header_boundary: 관리 확장 소유권 때문에 실제 queue grants는 변경되지 않음
- gmail_scheduler_signed_requests: 장기 키를 HTTP 대기열에 넣지 않는 120초 HMAC dispatcher 적용 성공
- 기존 Source/Evidence/사용자 수정값/저장 RPC 유지. 과거 전체 메일 등록 없음.
- queue/budget RLS 활성, anon/authenticated/service_role 직접 조회 금지 확인.
- enqueue만 본인 ITEM에 한해 authenticated 실행 허용. claim/finish/free claim은 service 전용.
- HMAC dispatcher는 private이며 browser/service_role 실행 불가. Cron postgres만 호출.

## 검증

- npm test: 295/295 PASS
- typecheck/lint/build/diff-check: PASS
- 실제 메일 2건 분석/분류/Action/Evidence 저장 및 제출 날짜 2026-10-18 확인은 이전 단계에서 수행.
- 성공한 제출 메일 재실행: Gemini 호출 0.
- 새 Production handler/실제 Cron 처리/테스트 계정 화면: 아직 검증 전.

## 운영 설정 상태

- Vercel 비밀값 등록 명령은 자동 승인 검토에서 거부되어 실행되지 않음.
- 기존 로컬 Gemini API 키 → Vercel Production, 신규 인증키 → Vercel Production/Supabase Vault라는 전달 범위의 사용자 확인 질문을 보냄.
- 로컬 ignored .env.local에만 신규 설정 준비. 비밀값은 Git/로그에 기록하지 않음.
- Production Cron은 아직 생성하지 않았음. 코드 배포 전후 실제 상태를 후속 기록으로 갱신.

## Security advisor

추가된 private 테이블의 policy 없음 INFO는 직접 접근 전체 거부 설계다. enqueue SECURITY DEFINER WARN은 명시적 소유자 검사/권한 경계를 검증한 의도된 API다. 기존 알림은 변경하지 않음.

- [RLS policy 알림](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [SECURITY DEFINER 실행 권한 알림](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [기존 Auth password protection 안내](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

AI Library Classification: NOT STARTED. Promotional: OFF. Cloud Run/결제 활성화: NO.
