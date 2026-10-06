# FINAL BACKEND GAP FIX

2026-10-06 (Asia/Seoul) · RESULT: **PARTIAL**

요청된 세 가지 Backend GAP의 코드는 구현했다. Classification 수정과 Action 완료/복원은 실제 HTTP/RLS 및 브라우저에서 검증했다. 후속 명시 승인으로 신규 RPC를 Drive/Upload만 허용하도록 제한했고 실제 Gemini 생성·검증·atomic 저장 및 override 보호도 확인했다. 최종 실제 분석 결과의 브라우저 Detail 확인은 로컬 연결 거부로 미완료다. 아래 과거 fixture 화면을 실제 모델 결과로 판정하지 않는다.

## 1. Schema preflight 결과

기존 classifications의 ai_* / user_* / user_edited_at과 actions의 status / completed_at / updated_at으로 두 쓰기 기능을 구현할 수 있었다. classifications는 기존 authenticated `set_classification_override` RPC를 사용한다. Action은 RLS 소유권 조회 후 서버에서 상태만 갱신한다. 기존 AI atomic persistence RPC는 Gmail/email만 허용했으므로 Drive/Upload용 최소 RPC 추가를 승인받았다. 원문 Evidence span 검증, ITEM 잠금, 사용자 override 보호, 중복 조정과 transaction rollback을 유지한다.

## 2. Migration 필요 여부

사용자 승인 후 dev `ai-hub-dev`에 `20261005162738_persist_eligible_item_analysis.sql`을 적용했다. `persist_eligible_item_analysis` 하나만 추가했다. 테이블·컬럼·enum·RLS·index·Storage 정책을 변경하지 않았다. 기존 Gmail RPC 본문은 동일하다. 새 RPC는 SECURITY DEFINER / 빈 search_path / service_role 전용 EXECUTE이며 anon·authenticated 실행은 차단했다. 승인 전 SQL과 rollback 검토는 `FINAL_BACKEND_GAP_PREFLIGHT.md`에 보존했다. rollback SQL은 실행하지 않았다.

후속 명시 승인에서 Drive/Upload만 허용하도록 지정했다. `20261006000216_restrict_eligible_analysis_to_drive_upload.sql`로 같은 RPC의 Gmail 허용 조건만 제거했다. 이미 적용한 migration은 수정하지 않았고 두 번째 RPC를 추가하지 않았다. 원격에서 Gmail 실제 입력 거부, Calendar 제외, 권한과 기존 corpus 동일 및 Gmail RPC 본문 동일을 확인했다. PostgreSQL 함수 정의/권한은 [공식 함수 문서](https://supabase.com/docs/guides/database/functions)를 확인했다.

## 3. Classification API

`PATCH /api/v1/items/{itemId}/classification` 구현. primaryTopic / documentType / tags만 허용하며 unknown field·빈 body·잘못된 UUID·길이/enum 오류를 거부한다. omitted 필드는 기존 override를 유지한다. null과 빈 tags 배열은 기존 SPEC 계약을 따른다. 응답은 aiClassification / userClassification / effectiveClassification / editedByUser / updatedAt / userEditedAt을 구분한다. UI에는 초기화 기능을 추가하지 않았다.

## 4. Classification E2E

실제 owner PATCH → Detail 재조회 → effective 값 및 직접 수정 표시 확인 PASS. anonymous 401, 타 사용자/존재하지 않는 ITEM 404, unknown field 400 PASS. 합성 AI 결과 저장 → 사용자 수정 → 변경된 합성 AI 결과 atomic 저장에서도 override 보호 PASS. 후속 실제 Gemini 재분석 후에도 사용자 주제와 effective 값 유지 PASS(DB 확인). 최종 실제 결과의 브라우저 재조회는 미검증이다.

## 5. User override protection

수정 API는 user_*만 저장하며 ai_*를 삭제하지 않는다. 기존·신규 persistence RPC의 AI 갱신은 user_*를 보존한다. SQL 및 실제 HTTP fixture 검증 PASS. partial PATCH는 현재 override를 읽어 기존 full-value RPC에 병합하므로 같은 사용자의 동시 저장은 읽은 snapshot 기준 마지막 저장이 반영된다. 이 한계를 API_SPEC에 기록했다.

## 6. Action complete/restore API

기존 naming에 맞춰 `PATCH /api/v1/actions/{actionId}/status`, body `{ "status": "completed" }` 또는 `{ "status": "open" }`. 서버 시간으로 completed_at을 기록하고 복원 시 null로 만든다. 동일 상태 요청은 timestamps를 유지한다. owner/id/status/updated_at 조건으로 충돌을 감지하고 최대 3회 시도 후 409를 반환한다. client의 completedAt 입력은 거부한다.

## 7. Action E2E

실제 complete → 동일 complete → restore → 동일 restore PASS. anonymous·cross-user·arbitrary ID 차단 PASS. Evidence / Source / Deadline / 관련 ITEM 보존 PASS. 실제 브라우저에서 합성 Action을 완료하고 완료 목록에서 복원한 뒤 기본 목록에 다시 나타나는 것을 확인했다.

## 8. Search/Action 연동

완료 Action은 기본 Search Action 결과에서 제외되고 복원 후 다시 포함된다. 상태 변경 이전 Search snapshot의 낡은 결과도 제외하는 기존 updated_at 조건을 SQL로 검증했다. `GET /api/v1/actions`는 open/completed 및 type/deadlineStatus 필터와 owner·필터에 결합된 서명 cursor를 지원한다. 기존 Actions UI 위치에서 완료 목록을 연결했다. D-Day는 confirmed deadline만 사용한다.

## 9. Gmail AI flow

이번 collect에서 성공한 ITEM 중 canonical text가 있고 현재 분석 artifact와 일치하지 않는 후보만 반환한다. 기존 Gmail RPC 및 Phase 6 분석 계약 유지. 신규/미분석/변경 후보를 브라우저에서 최대 3개 순차 처리한다. 전체 기존 Gmail 재분석은 하지 않았다. candidate discovery 테스트 PASS; 이번 작업에서 개인 Gmail의 새 실제 모델 성공 E2E는 실행하지 않았다.

## 10. Drive AI flow

Drive/document의 서버 저장 canonical text만 분석한다. 이번 collect 결과의 성공 ITEM에서 신규·변경·미분석 후보를 선별하고 unchanged + current artifact는 skip한다. 새 RPC로 atomic 저장한다. collector candidate 테스트, SQL 및 synthetic Drive 실제 HTTP 검증 PASS. 실제 Gemini 생성 성공은 미검증이다.

## 11. Upload AI flow

PDF/image의 extraction.status=complete, version=upload-text-v1 및 canonical text가 있는 ITEM만 분석한다. 기존 PDF.js/Tesseract 업로드 persistence 완료 후 저장된 ITEM id로 분석한다. 실제 합성 PDF 업로드·추출·저장·자동 분석 시도 PASS, 최초 생성은 503으로 실패했고 원본/ITEM은 남았다. 후속 승인 후 같은 PDF의 서버 분석을 재시도해 503 → 200, 실제 gemini-3.7-flash/v0.2 결과와 Action 1개 저장 PASS. 이는 실제 서비스 함수와 provider/DB를 실행한 CLI harness이며 로그인 인증 adapter는 테스트에서 교체한다. 인증/소유권은 별도 실제 HTTP 테스트로 검증했다. extraction 미완료 입력은 차단한다.

## 12. Calendar 정책

자동·수동 AI 분석 대상에서 제외한다. 기존 Calendar 수집 코드는 변경하지 않았다. event date를 deadline으로 바꾸거나 event 자체로 Action을 생성하지 않는다. eligibility 및 SQL 거부 테스트 PASS. manual source도 이번 대상에서 제외했다.

## 13. Gemini failure handling

기존 429/503 retry 정책(초기 요청 + 최대 2회 retry, 총 timeout 120초)을 재사용한다. 수집과 분석은 별도 transaction이며 분석 실패는 저장된 ITEM을 rollback하지 않는다. 한 번의 사용자 동작에서 최대 3개 ITEM을 순차 분석하며 개별 실패는 다음 ITEM을 막지 않는다. 초과 후보는 대기 안내와 Detail 재시도로 처리한다. 페이지 종료 후 실행 보장은 없으며 queue/cron/worker를 추가하지 않았다.

429 / 503 / timeout / malformed / validation / persistence 실패는 mock·격리 테스트에서 검증했다. 실제 외부 장애로 관찰한 것은 503이다. 합성 ITEM에 3번의 논리적 분석 실행만 했으며 각 실행은 기존 retry 상한을 따른다. CLI 진단에서 3회 연속 HTTP 503을 확인했고 마지막 브라우저 재시도도 실패했다. 모델 metadata 조회는 200이며 generateContent 지원을 확인했으나 생성 성공을 뜻하지 않는다. raw response/secret은 출력하지 않았고 모델 교체나 무한 retry를 하지 않았다.

위 3회는 최초 보고 시점 기록이다. 후속 명시 승인 후 같은 합성 PDF에 논리적 재시도 1회(실제 provider 503 후 200, 2회 호출)를 추가했고 성공했다. 이어 동일 분석 캐시 확인은 provider 호출 0회/cached=true/Action 1개로 PASS. 원문 일치 current Evidence 1개와 이전 fixture의 historical Evidence 1개를 확인했다. 확정 deadline은 원문 근거의 2026-10-15이며 행사일과 구분된다.

## 14. RLS / Security

쿠키 사용자 인증 → RLS owner 조회 → 명시적 owner 검증 후 서버 전용 쓰기를 수행한다. 동일 origin·8 KiB body 제한·허용 key 검증·private no-store 응답을 적용했다. analyze는 arbitrary userId/model/force 입력을 거부한다. 외부/익명 사용자 차단과 새 RPC role 경계 PASS. service_role 및 raw Gemini 응답은 브라우저에 반환하지 않는다.

Security Advisor는 새 RPC를 지적하지 않았다. 기존 authenticated SECURITY DEFINER 함수 3개 경고 및 leaked password protection 비활성화 경고는 남아 있으며 이번 범위에서 정책을 변경하지 않았다. 기존 private 서버 테이블 5개의 RLS-no-policy INFO도 유지된다. 참고: [함수 권한 검사](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [비밀번호 보호](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 15. 기존 데이터 보존

실제 작업 시작 기준은 요청문의 과거 50개가 아니라 **57개: Gmail 51 / Drive 1 / Calendar 1 / Upload 4**였다. migration 전후 비자격증명 데이터 비교 및 최종 기존 corpus 비교가 동일했다. 기존 ITEM / Classification / Action / Evidence / Search chunks / Storage 객체 및 연결의 비자격증명 상태를 보존했다. token·secret 및 그 파생 hash/fingerprint는 비교하거나 출력하지 않았다.

최종 **58개: Gmail 51 / Drive 1 / Calendar 1 / Upload 5**. 증가 1개는 브라우저로 올린 `synthetic-backend-gap.pdf`이며 검토용으로 유지했다. 해당 ITEM의 deterministic 결과 fixture는 실제 모델 결과가 아니며 model label도 gemini-synthetic-fixture다. 사용자 수정과 Action/Evidence UI 검증에만 사용했다. 별도 HTTP 테스트용 사용자 2명과 합성 corpus는 종료 후 정리했다. 개인자료·Google 원본은 삭제하지 않았다.

후속 실제 분석으로 이 합성 ITEM의 현재 artifact는 gemini-3.7-flash 실제 결과로 갱신됐다. fixture Evidence는 historical로 보존됐다. 다른 기존 개인 ITEM은 분석하지 않았다. RPC 제한 migration 전후 corpus 비교는 동일했고 실제 HTTP 8개 테스트 재실행 후 합성 principal/corpus도 정리했다.

## 16. Browser E2E

합성 PDF 업로드 → 자동 analyze 실패 → 저장된 ITEM 확인; Detail 분류 수정 → 서버 저장 → 직접 수정 표시; Actions 완료 → 완료 목록 → 복원 → 기본 목록 반영 PASS. 후속 실제 AI 생성 → validation → Classification/Action/Evidence atomic 저장 → override 보호는 CLI/DB에서 PASS. 실제 결과의 브라우저 Detail 재조회는 **미완료**다. fixture 화면을 모델 성공 증거로 사용하지 않는다.

최종 build 후 추가 IAB 재접속은 localhost 연결 거부로 확인하지 못했다. 같은 시점 shell HTTP `/login`은 200이었다. 이 마지막 재접속을 PASS로 기록하지 않는다. 앞서 dev 브라우저에서 수행한 기능 검증과 스크린샷은 보존했다.

후속 재접속도 실패했다. 0.0.0.0 바인딩 시도는 자동 승인 검토가 외부 노출 위험으로 거부해 실행하지 않았다. loopback 127.0.0.1 서버만 재시작했으나 IAB 연결 거부는 해소되지 않았다. 보안 설정을 낮추거나 외부 노출로 우회하지 않았다.

## 17. UI regression

기존 Layout / Navigation / Typography / Color / Card / Spacing을 유지했다. 기존 버튼·필드 스타일과 표시 위치에만 쓰기/분석 상태를 연결했다. Desktop 1440×900 및 Mobile 390×844 viewport에서 합성 Detail을 확인했고 가로 overflow를 발견하지 않았다. 실제 iOS/Android 단말·전체 접근성 검사는 수행하지 않았다.

증거: [Desktop](gap-verification/detail-desktop.jpg), [Mobile](gap-verification/detail-mobile.jpg). 두 화면의 분석 영역은 deterministic fixture이며 Gemini 성공 결과가 아니다.

## 18. 신규 tests 수 / 전체 tests 수

`npm test`: **기존 136 + 신규 25 = 161 PASS**. 신규 gap 격리 테스트 23개, Gmail/Drive candidate 테스트 각 1개다. 별도 SQL 검증 `test-gap-sql.mjs` **7 PASS**, Search SQL **11 PASS**(신규 상태 연동 1개 포함), 실제 dev HTTP/RLS `test-gap-live.mjs` **8 PASS**. 별도 실행 결과를 npm test 161개에 중복 합산하지 않는다. HTTP fixture 테스트의 Gemini 호출은 0회다.

## 19. typecheck/lint/build/check:supabase/diff

`npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:supabase`, 최종 `git diff --check` PASS. build에서 새 routes 및 기존 PDF/OCR worker asset 생성을 확인했다. npm audit fix --force 및 runtime dependency 추가는 하지 않았다.

## 20. 문서 갱신

SPEC.md 39절 / API_SPEC.md 27절에 승인된 구현 계약·eligible source·bounded 실행·실패 격리·동시 수정 한계·실제 검증 미완료를 기록했다. PROJECT_STATE.md 19절과 상단 현재 상태를 PARTIAL로 갱신했다. 승인 전 preflight 기록과 이 26항목 보고서를 추가했다. 기존 Polished UI 보고서의 이전 변경은 보존했다. Notion은 수정하지 않았다.

## 21. 남은 P0

세 가지 GAP의 구현 잔여는 0개다. **완료 판정에 필요한 검증 P0는 1개: 실제 Gemini 결과의 브라우저 Detail 확인**. 실제 생성·validation·atomic persistence·사용자 override 보호는 확인했으며 브라우저 마지막 단계만 남았다. 지금 P0=0이라고 선언하지 않는다.

## 22. 남은 P1

기존 Production/Vercel Linux 환경 검증, 실제 모바일 단말 및 접근성 검증, 기존 보안 경고 후속 검토는 이번 작업 완료 범위 밖이다. 새 인프라/배포/정책 변경은 시작하지 않았다. 브라우저 종료 후 분석 지속은 현재 orchestration의 명시적 한계다.

## 23. 남은 P2

최종 UI 디자인 고도화, Evidence 하이라이트 등 기존 후속 UI 항목은 별도 단계로 유지한다. 이번 작업에서 기능이나 디자인 범위를 확대하지 않았다.

## 24. FINAL BACKEND GAP FIX COMPLETE 여부

**아니오 — PARTIAL.** 실제 AI 서버 경로까지 성공했지만 최종 브라우저 확인이 남아 있다.

## 25. MVP Backend Integration COMPLETE 여부

**아니오.** 기존 완료 단계는 유지하며 이번 외부 장애를 근거로 전체 통합 완료를 선언하지 않는다.

## 26. 다음 단계 진행 가능 여부

현재 API와 최소 UI 연결은 검토할 수 있다. 다음 단계는 로컬 브라우저 연결 복구 후 동일 합성 ITEM의 실제 분석 결과·사용자 수정·Action/Evidence를 확인하는 것이다. 새 Gemini 호출은 필요하지 않다. 이 검증 전 Backend COMPLETE 판정은 보류한다. Frontend Visual Redesign 및 Production 배포는 시작하지 않았다.
