# Preview E2E 검증 체크리스트

승인된 Preview 환경에서 합성 자료로 재사용하는 검증 절차다. 이 문서는 특정 배포의 PASS 기록이 아니다. Production 배포 및 개인자료 전체 AI 분석·embedding backfill은 별도 승인 없이 수행하지 않는다.

## 1. 배포 전 게이트

- [ ] 기존 Vercel 프로젝트, 연결된 Git 저장소, Production Branch를 확인한다. 환경별 연결 정보를 확인하고 기존 설정을 임의 변경하지 않는다.
- [ ] **신규 프로젝트의 첫 배포는 Production으로 분류되므로 실행하지 않는다.** 기존 프로젝트의 Preview 경로가 확인되어야 한다. [Vercel 환경 문서](https://vercel.com/docs/deployments/environments)
- [ ] 변경 파일과 secret 제외를 확인한 뒤 Preview용 `codex/preview-final-e2e` 같은 브랜치를 사용한다. 실행 전 해당 환경의 변경 승인을 확인한다. 해당 브랜치가 프로젝트의 Production Branch가 아님을 확인한다.
- [ ] 이번 작업의 UI/문서/폰트/합성 fixture만 commit 대상으로 검토한다. `.env.local`, `.next`, `.temp`, `public/ocr` 생성물, ZIP, credential, raw HAR는 제외한다. 검증 대상 commit의 실제 diff를 확인한다.
- [ ] Git 연동 또는 기존 프로젝트의 Preview 배포 기능으로 배포하고 Dashboard의 Environment가 **Preview**인지 확인한다. Production 승격/`--prod`/Production Branch push를 실행하지 않는다.
- [ ] 검증 배포의 commit SHA, deployment ID, 고정 deployment URL과 사용한 branch alias를 기록한다. alias가 다음 commit으로 이동하면 검증을 무효화하거나 해당 SHA를 다시 확인한다.
- [ ] Preview 런타임에서 현재 Node/Next 요구사항, Linux native dependencies, 함수 duration을 확인한다. analyze 180s, Google sync 300s, Drive/Calendar/Upload 150s 등 기존 route 설정이 적용되어야 한다. 설정을 임의 단축하지 않는다. [Vercel duration 문서](https://vercel.com/docs/functions/configuring-functions/duration)

실행 전 원격 상태와 검증 대상 diff를 확인한다.

## 2. Preview 환경 및 인증

- [ ] Preview 범위 환경변수의 **존재 여부만** 확인한다: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GOOGLE_DATA_CLIENT_ID`, `GOOGLE_DATA_CLIENT_SECRET`, `GOOGLE_DATA_REDIRECT_URI`, `GOOGLE_DATA_TOKEN_ENCRYPTION_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `SEARCH_CURSOR_SECRET`. 기존 환경의 legacy server-key fallback은 코드 기준으로 확인한다. 값은 보고서/터미널/commit에 출력하지 않는다.
- [ ] 테스트용 Supabase/계정 사용 범위를 확인한다. 기존 Google 토큰을 재사용한다면 encryption key를 임의 재발급하지 않는다. 검색 cursor secret은 인스턴스 간 일관성을 유지한다.
- [ ] `SEARCH_SEMANTIC_ENABLED=false` 기본값을 유지하거나 비민감 합성 ITEM만 명시적으로 허용한다. 개인자료 embedding/backfill을 실행하지 않는다. 브라우저 OCR 경로를 사용하며 managed OCR 자동 호출을 켜지 않는다.
- [ ] Preview 환경변수 변경 후 해당 commit을 재배포한다. public 변수는 build에 반영되어야 한다. [Vercel 환경변수 문서](https://vercel.com/docs/environment-variables)
- [ ] Supabase Auth redirect allowlist에 실제 방문할 HTTPS Preview origin의 `/auth/callback`을 좁게 허용한다. 기존 Production Site URL을 임의 변경하지 않는다. [Supabase redirect 문서](https://supabase.com/docs/guides/auth/redirect-urls)
- [ ] Google **데이터 연결** OAuth의 redirect는 동일 Preview origin의 `/api/v1/connections/google/callback`이며 Google Console 등록 URI와 `GOOGLE_DATA_REDIRECT_URI`가 정확히 일치한다. 로그인용 Supabase Google provider callback과 구분한다.
- [ ] OAuth 시작과 완료를 동일 host에서 수행한다. commit URL에서 시작해 다른 alias로 callback하면 origin별 cookie/state 검증에 실패할 수 있다.
- [ ] Deployment Protection이 필요한 경우 정식 접근으로 통과한다. OCR worker/WASM/kor+eng language/PDF worker 요청이 보호 로그인 HTML로 바뀌지 않는지 확인한다. CSP를 약화시키지 않는다.

## 3. 실제 브라우저 실행

각 항목은 `PASS / FAIL / NOT_RUN` 및 배포 SHA, viewport, 비민감 evidence 파일명을 기록한다. 로컬 PASS/isolated test/캐시 응답은 실제 Preview 새 분석 성공을 대신하지 않는다. Account A/B 모두 합성 데이터만 쓰며 인증 harness로 우회하지 않는다.

| 단계 | 실행 | PASS 기준 |
|---|---|---|
| Login | 로그아웃 → 실제 Google 로그인 → Home → 새로고침 | 정상 callback/session, 보호 화면 접근, 로그인 실패 메시지 없음 |
| Desktop | 1440px Home/Search/Detail, Library/Actions/Settings smoke | Pretendard, warm background/surface, navigation active, 검색/Detail hierarchy, 잘림 없음 |
| Search → Detail | 합성 제목/본문 검색 → excerpt/evidence 확인 → Detail | 실제 결과와 같은 ITEM, 원문 위치/출처 확인, 검색 상태 정상 |
| Classification | 기존값 기록 → 주제/분류 수정 → 저장 → hard reload/재조회 | 실제 저장값 반영; 분석 재실행 후 User Edited 유지; 마지막에 기존값 복원 |
| Action | 합성 open Action 완료 → Actions 목록/Detail 재조회 → 복원 → 재조회 | 완료 상태/목록 반영, 복원 후 open 및 원래 목록 반영, 중복 Action 없음 |
| Google | 아래의 테스트 전용 3 source 연결/수집/재사용 | 실제 connection 상태, 각 1건 source 추적 및 재사용; 날짜만 있는 event는 Action 미생성 |
| Drive AI | 합성 Drive 문서의 실제 분석 완료 → Detail reload | 원문/요약/Action/deadline/evidence 표시; cached 여부를 구분 |
| Upload/OCR | fixture PNG 1건 업로드 → 실제 OCR → Detail | 한국어/영어 추출 저장 및 원본 접근; 실패해도 ITEM/OCR 보존 |
| Image AI | 새 이미지의 실제 AI 완료 → Detail reload | 실제 유효 분석 저장, `2026-12-31` 제출 마감과 `2027-01-10` 행사 구분, 원문 Evidence |
| 기존 503 | 이전 실패 합성 이미지 1건 수동 재분석 | 실제 HTTP/body 확인; 성공이면 Detail 반영, 실패이면 아래 보존/진단 기록 후 FAIL |
| Mobile | 390px Home/Search/Detail, 검색→Detail, 원문/AI tabs | 하단 navigation, 가로 overflow 없음, 읽을 수 있는 typography, 원문/AI 접근 가능 |
| Auth/RLS | 로그아웃 보호 화면/API, 별도 합성 계정 B로 A ITEM 접근 | 접근 차단, 타 계정 원문/분류/Action 노출 및 수정 불가; 권한 우회 없음 |

Mobile에서 viewport 너비를 390으로 설정하고 각 화면 및 Detail 양쪽 tab에서 `document.documentElement.scrollWidth <= window.innerWidth`를 확인한다. UI 클릭 동작은 실제 사용자 흐름으로 수행한다. 실패/console error가 있으면 축소하여 숨기지 않는다.

### Google 최소 수집 범위

Gmail/Drive 수집 UI는 수집된 ITEM 중 일부에 자동 AI 분석을 호출한다. **실제 개인 계정에서 대량 수집을 시작하지 않는다.** 테스트 전용 Google 계정의 최근 수집 범위에 합성 자료만 둔다. Gmail UI에는 단일 메일 선택 제한이 없으므로 합성 INBOX 1건만 있는 계정이 필요하다.

- [ ] Gmail: 최근 범위의 합성 INBOX 메일 1건, 의무/마감/Evidence 포함 → 연결/수집 → Detail → 두 번째 수집 재사용/중복 없음 확인.
- [ ] Drive: 명시적 파일 선택으로 합성 Google Docs 1건 → 수집/실제 AI/Detail → 재수집 결과 확인. 단순 기존 캐시를 새 AI 성공으로 기록하지 않는다.
- [ ] Calendar: 기본 수집 기간 내 합성 primary event 1건 → 연결/수집 → event date 및 Source 표시 → 재수집 확인. 참가 행동 요구 없이 행사 날짜만으로 Action을 생성하지 않는다.
- [ ] 개인자료가 섞여 있거나 테스트 계정이 없으면 해당 Google 항목을 NOT_RUN으로 남긴다. 전체 분석이나 backfill로 대신하지 않는다.

### Upload fixture

`tests/fixtures/preview-e2e/synthetic-preview-e2e.png`를 사용한다. 원문/기대 결과/hash는 같은 폴더 README 참조. 최초 업로드와 hash 중복 재사용을 구분한다. 합성 fixture를 실제 업로드해 OCR을 실행한 증거가 있어야 한다. provider mock/seed는 금지한다.

## 4. HTTP 503 재검증과 중단 기준

1. 재시도 전에 기존 합성 ITEM의 원문/OCR/원본 접근/분류 override/기존 유효 AI/Action/Evidence를 기록한다. 민감 콘텐츠 대신 합성 alias 및 상태를 사용한다.
2. 기존 실패 합성 이미지에 수동 분석 **1회**만 실행한다. 새 fixture의 자동 분석과 별도 요청으로 기록한다. 503이 재발하면 요청 status, content-type, 안전한 `error.code`/`error.message`, 소요시간, 필요시 비민감 request ID를 기록한다. Header/cookie/token/signed URL/prompt/raw provider body/전체 HAR는 출력하지 않는다.
3. `/api/v1/items/{id}/analyze`의 JSON 503을 Vercel HTML/plain timeout 오류와 구분한다. 실제 API 503만으로 upstream Gemini도 503이었다고 단정하지 않는다. 현재 공개 body에는 upstream status가 없다. upstream status는 안전한 서버 metadata가 실제 제공될 때만 별도로 기록한다.
4. 현재 코드상 Gemini 총 budget 120초, 최초 포함 최대 3회 호출, HTTP 429/503만 자동 재시도, 기본 backoff 2/4초 및 Retry-After 반영, 대기 10초 초과/잔여 budget 부족이면 중단한다. Network/timeout/invalid response는 추가 자동 반복하지 않는다. `src/lib/gemini/client.ts` 및 관련 isolated tests로 확인한다. 실제 Preview trace가 없으면 provider 호출 횟수는 미관측으로 기록한다.
5. `GEMINI_NOT_CONFIGURED / GEMINI_UNAVAILABLE / GEMINI_INCOMPLETE`는 503, 분석 validation 실패는 422, 중복 분석은 409를 구분한다. 앱의 안전한 오류 mapping과 실제 응답을 대조한다. 일시 오류와 Vercel duration, API key/model 설정은 값 노출 없이 진단한다.
6. 실패 후 hard reload/재조회하여 ITEM/OCR/원본/사용자 수정값/기존 유효 결과가 유지되는지 확인한다. processing status의 failed 전환은 허용되지만 유효 분석/Action/Evidence 손실은 FAIL이다.
7. 원인이 일시 장애로 확인되고 cooldown을 둔 경우에만 **추가 수동 재검증 최대 1회**를 허용한다. 자동 반복/무한 polling 분석 요청/전체 재분석 금지. 반복 실패면 중단하고 미해결 blocker로 기록한다.

현재 분석 route는 180초 한도이고 함수 플랫폼의 실제 적용 값은 Preview에서 확인해야 한다. 코드와 unit test가 bounded retry를 보장해도 Preview의 실제 AI 성공을 보장하지 않는다.

## 5. 최종 판정 및 보고

- [ ] 아래 여섯 검사를 검증 commit에서 통과: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:supabase`, `git diff --check`.
- [ ] `check:supabase`는 공개 Auth 연결 검사이며 실제 DB/RLS/로그인 E2E의 대체가 아니다.
- [ ] 모든 필수 Preview 시나리오 PASS, 미해결 P0=0, secret 출력/Production 배포/개인자료 backfill 없음.
- [ ] 각 시나리오의 실행 환경·결과·근거·미검증 항목을 별도 검증 기록에 남긴다.

판정: 전체 PASS이면 `MVP_READY_FOR_PRODUCTION` 및 Production 승인 대기. 일부 미검증이면 `PARTIAL`; 재현된 결함이면 `NEEDS_FIX`; Preview 접근/설정 등 외부 선행조건 때문에 실행 자체가 불가능하면 해당 단계 `BLOCKED`. NOT_RUN을 PASS로 바꾸지 않는다. 준비 결과와 전체 제품 준비 판정은 구분한다.
