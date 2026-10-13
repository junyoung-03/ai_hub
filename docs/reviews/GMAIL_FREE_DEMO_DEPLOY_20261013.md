# 무료 Gmail 시연 배포 기록

사용자 승인: DB 적용, 한국어 커밋, push, Production 배포 및 테스트 계정 화면 확인.

## 후속 키 등록 및 실제 실행 (2026-10-13)

- 사용자에게 Vercel/Supabase Vault 비밀값 전달과 이번 세션 Google 계정 전환의 명시적 허용을 받았다.
- 운영 키/모델/테스트 범위 등록 완료. Vault 인증키/범위 등록 완료. 비밀값은 출력/Git 기록하지 않았다.
- 환경 반영 재배포 dpl_2TSSDBRtpqoCNCZgAY4YaWn2Abws: Ready.
- 실제 Vault HMAC → pg_net → Production handler HTTP 200 확인. 응답 성공을 분석 완료로 계산하지 않는다.
- 첫 작업은 모델 변경으로 기존 성공 결과를 다시 생성한 후 ANALYSIS_PERSISTENCE_REJECTED로 실패했다. 추가 호출을 멈추고, 동일 본문의 검증된 성공 결과를 원래 model/fingerprint로 재사용하도록 worker를 최소 수정했다.
- 회귀 테스트 296/296, typecheck/lint/build 통과. 수정된 로컬 worker → 실제 DB 재사용 완료 1건, Gemini 호출 0회 확인. 추가 수정 운영 반영도 사용자 승인을 받았다.
- 종료 시각 없는 Cron은 자동 승인 검토에서 거부되어 15분 종료 시각을 명시한 범위 제한 Cron으로 바꿨다. 수정 배포 확인 전 시연 Cron은 중지했다.
- Google 테스트 계정 로그인은 성공했다. 추가 gds 도메인 확인도 사용자 허용을 받은 뒤, 복구/주소 설정은 변경하지 않고 건너뛰었다.
- 테스트 계정의 운영 Detail에서 분류/태그/제출 Action/Evidence, Planner의 동일 제목 1개와 10월 18일 마감, Home의 10월 18일 Calendar cell 표시를 확인했다. 원문을 포함한 screenshot은 로컬 검증 산출물로만 저장하며 Git에 넣지 않는다.
- 세 번째 승인 메일은 실제 Production HMAC handler에서 complete=1/failed=0으로 분석·저장됐다. 기존 2건과 합쳐 승인 메일 3건에 저장된 분석 결과가 있다.
- 아래 키 등록 대기 내용은 직전 배포 시점 기록이며 현재 차단 상태가 아니다.

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
