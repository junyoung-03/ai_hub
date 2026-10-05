# 테스트 실행 안내

## Search-2

- `npm run test:search`: Query/privacy/provider mock/chunk/intent/cursor 격리 검사. 외부 호출/DB 쓰기 없음.
- `npm run test:isolated:search-sql`: 기존 ignored PGlite runtime+vector로 신규 SQL을 임시 메모리 DB에서 실행. 원격 DB/Embedding 없음. 기존 Calendar/Upload SQL suite와 같은 runtime 경로.
- 실제 품질 gate는 `docs/SEARCH_GOLDEN.md`. mock vector를 실제 semantic 품질로 확대하지 않는다.
- Backfill은 build/test에서 자동 실행하지 않는다. Migration은 dev에 적용됐지만 runner 실행은 별도 승인 후에만 `node --env-file=.env.local scripts/search-backfill.mjs --user <owner UUID>`로 수행한다. 실행당 최대 5 ITEM, 기본 lexical-only다. 진행은 ignored supabase/.temp 파일에 보관하며 `--resume`으로 고정 startedAt/id keyset과 pending/failed를 이어간다.
- `--semantic-non-sensitive`는 enabled와 해당 batch 전체의 서버 allowlist 조건을 모두 충족할 때만 허용한다. 미승인 ITEM이 섞이면 전송 전에 거절한다. 실제 개인 전체 semantic backfill은 별도 승인 전 금지다. ITEM runner cycle당 최대 8개 독립 embedding, 동시 1개, Query/document 공통 quota 10/min이다.
- 실패 budget 3회 소진 후 본인 index endpoint의 `{retry:true}`로 수동 재시도한다. 긴 sleep/무제한 retry는 없다. stdout은 개수/상태만 출력하며 owner/ITEM ID/본문/Query/Token을 출력하지 않는다.

프로젝트 루트에서 실행한다. 기본 `npm test`는 외부 서비스와 실제 DB에 접근하지 않는 격리 테스트만 실행한다. 실연결 검사는 별도 명령으로 실행하며 Secret, Token, JWT 또는 메일 원문을 출력하지 않는다.

## 명령과 영향 범위

| 명령 | 실행 파일 / 범위 | 외부 서비스 | 실제 DB 변경 |
| --- | --- | --- | --- |
| `npm test` 또는 `npm run test:isolated` | 아래 7개 격리 테스트 파일 | 없음 | 없음 |
| `npm run lint` | ESLint | 없음 | 없음 |
| `npm run typecheck` | TypeScript | 없음 | 없음 |
| `npm run build` | Next.js build | 현재 구현에서 없음 | 없음 |
| `npm run check:supabase` | `check-supabase.mjs` | Supabase Auth 설정 GET | 없음 |
| `npm run test:live:google-refresh` | `test-gmail-refresh-live.mjs` | 개발 Supabase 및 Google token/profile API | 테스트 계정의 암호화 Token bundle 갱신 |
| `npm run test:live:analysis-db` | `test-analysis-db.mjs` | 개발 Supabase | 합성 데이터 transaction 후 전체 rollback |
| `npm run test:live:drive-oauth-db` | `test-drive-oauth-db.mjs` | 개발 Supabase | 합성 사용자/연결/Token transaction 후 전체 rollback |
| `npm run test:live:drive-db` | `test-drive-db.mjs` | 개발 Supabase | 적용 승인 후 합성 ITEM/분류/Action/Evidence transaction 후 rollback |
| `npm run test:live:drive` | `test-drive-live.mjs` | 기본은 개발 DB Scope 확인만; `--collect`는 실제 Drive/Docs | `--collect`에서 명시한 Docs 1건 ITEM 생성/업데이트 |
| `npm run test:live:analysis` | `test-analysis-live.mjs` | 개발 Supabase + Gemini | 최대 5개 실제 저장 Gmail ITEM 분석 저장 |

## 격리 테스트

```bash
npm test
```

- `test-auth.mjs`: Callback, 인증 helper, 보호 Route, 서비스 로그인·로그아웃 경계.
- `test-items.mjs`: 필터/Cursor, 사용자별 읽기, Detail whitelist, 안전한 오류 응답.
- `test-gmail.mjs`: 합성 MIME/HTML/Header 파싱, Token 갱신 mock, 100건 상한, 중복/부분 실패/사용자 격리.
- `test-google-connections.mjs`: 합성 Token의 AES-GCM roundtrip/tamper, RPC 인자, Refresh Token 유지/교체 및 연결 해제.
- `test-analysis.mjs`: v0.2 schema, 원문/Unicode Evidence 위치, 날짜 구분, no-action, Gemini mock, 저장 전 validation 및 transaction retry/사용자 격리, 429/503 최대 재시도.
- `test-drive-oauth.mjs`: Drive-3 Scope/purpose/state/callback, 거절·부분 동의·다른 계정·refresh 실패 저장 차단, 암호화 RPC 인자 및 SQL 초안 정적 규칙. 실제 DB/Google 호출 없음.
- `test-drive.mjs`: 입력 경계, Docs 모든 tab/본문/표/목차/제외 metadata/Unicode 범위, Google 요청 계약/retry, create/reuse/update, SOURCE_CHANGED, 상한/병렬/timeout/API 거절 및 SQL 정적 검사.

Fixture는 메모리에 있으며 실제 메일, Secret 또는 DB 연결이 필요하지 않다. Google Connection 파일은 기존 assertion suite를 하나의 파일 단위 테스트로 실행한다. Phase 6A는 9개 개별 검사를 추가한다.

Drive-3는 총 75개 격리 테스트 PASS. 기존 Gmail 테스트 연결의 실제 refresh 1회/profile 및 Token/Scope/checkpoint 보존 PASS.
동일 계정 Drive 추가 동의 후 저장 Scope/계정/연결/Gmail checkpoint 확인 PASS. 지정 Docs 1건 실제 생성/reuse/조회/원본 URL/사용자 RLS/Gmail 보존 PASS. Drive-3 및 전체 Drive COMPLETE. DB 실행 결과는 아래 별도 검사 기록을 따른다.
두 SQL 초안은 임시 도구 pglast 8.5로 SQL 및 PL/pgSQL 구문 분석 PASS이며 앱 dependency에는 추가하지 않았다.
파서 구문 검사는 실제 DB 관계·권한·동시성 실행 검증을 대신하지 않는다.
Scope Migration은 2026-10-05 ai-hub-dev 적용/history 등록 및 RPC 런타임 검증 PASS다. 다른 환경에 적용된 것으로 간주하지 않는다.

## Drive-3 Scope RPC 실제 DB 검사

`DRIVE_OAUTH_TEST_PROJECT=oclzdppdiljbojvqtkeu`를 명시하고 Supabase CLI 인증 후 `npm run test:live:drive-oauth-db`를 실행한다.
service_role 전용 권한, 부분 Scope/다른 계정/소유권/오래된 snapshot 거절, 실패 원자 보존,
Gmail checkpoint 보존, downgrade 방지, guarded refresh와 disconnect 저장 차단을 검증한다.
합성 데이터는 전체 rollback한다. Google API는 호출하지 않는다. 적용 전 `--with-draft`는 Scope DDL도 rollback한다.
이미 적용된 DB에서는 `--with-draft`를 사용하지 않는다. persist_drive_item 초안은 읽거나 적용하지 않는다.
다중 세션 동시성 및 Browser 추가 동의 성공 검증을 대신하지 않는다.

## Drive-3 실제 Docs 검증 — 적용/사용자 동의 후 실행

`DRIVE_DB_TEST_PROJECT=oclzdppdiljbojvqtkeu`에서 `npm run test:live:drive-db`는 적용된 persist_drive_item을 검증한다.
`--with-draft`는 별도 적용 승인을 받은 뒤, 적용 전에만 DDL도 포함하여 transaction/rollback 검증한다.
권한/create/reuse/update/hash/size/stale CAS/분류·Action·Evidence·override 보존/사용자 RLS/disconnect를 검사한다.
2026-10-05 승인 후 적용 전 DDL+합성 rollback 및 적용 후 Runtime rollback PASS. 실제 Docs/Gemini 호출 없음.
신규 Migration은 20261005013202_persist_drive_item.sql이며 기존 Migration 파일/기존 실제 데이터/스키마/이력을 보존했다.
적용 후에는 --with-draft를 사용하지 않는다. 사용자가 지정한 1건의 실제 E2E는 2026-10-05 PASS했으며 추가 수집 없이 정지했다.

`DRIVE_LIVE_TEST_PROJECT=oclzdppdiljbojvqtkeu`에서 `node scripts/test-drive-live.mjs --before-consent`로
기존 Gmail 수집 이력이 있는 단일 연결의 소유권·Scope·checkpoint만 Git-ignored 파일에 내부 보관한다. Token은 기록하지 않는다.
같은 Google 계정으로 Settings의 Drive/Docs 추가 동의 후 `npm run test:live:drive`는 저장된 Scope/계정/checkpoint를 읽어 확인한다.
사용자가 명시한 1건의 fileId를 `DRIVE_TEST_FILE_ID`에 설정하고 `node scripts/test-drive-live.mjs --collect`를 실행하면
실제 metadata/Docs/ITEM/재수집 reuse/Library·Detail 코드/original_url/Gmail ITEM 불변을 검증한다.
수집 전후 Gmail connection Scope·전체 sync_state·last_synced_at 및 기존 Classification/Action/Evidence graph도 hash 비교한다.
저장된 실제 ITEM에 대해 타 사용자 서버 조회 및 authenticated DB RLS 읽기 차단을 검사하며 SQL claims/role 변경은 transaction/rollback한다.
CLI에서는 auth/cookie adapter를 개발 DB admin으로 대체하므로 실제 사용자 RLS는 위 SQL 검사로, Browser 접근은 별도로 검증한다.
최초 1건 PASS 전 대상 추가 금지. Google 원본 수정 및 Gemini 호출은 하지 않는다. 본문/제목/계정/credential/raw error 출력 금지.

## Phase 6A 실제 분석 검증 — 명시적 실행

`ANALYSIS_TEST_PROJECT=oclzdppdiljbojvqtkeu`를 명시하고 DB 검사는 Supabase CLI 인증이 필요하다.
실제 분석은 추가로 `ANALYSIS_TEST_EMAIL`에 테스트 소유자를 지정하고 서버 Supabase Secret,
`GEMINI_API_KEY`, `GEMINI_MODEL`을 설정한다. 환경값은 출력하지 않는다.
`npm run test:live:analysis-db`는 합성 사용자/ITEM에 대해 저장·권한·override·중복·실패 rollback을
검증한 뒤 전체 rollback한다. `--with-draft`는 함수 DDL도 같은 rollback transaction 안에서만 검증한다.
`npm run test:live:analysis`는 실제 계정 소유권을 확인하고 서버 분석 코드를 최대 5개 ITEM에 실행한다.
선택 ID는 Git-ignored `supabase/.temp/phase6a-selection.json`에 유지해 실패 후 재시도 대상을 늘리지 않는다.
이미 성공한 결과는 캐시를 사용한다. 실제 Browser session 검사는 대체하지 않는다.
Gemini는 ITEM당 최초 포함 최대 3회, 429/503만 제한적으로 재시도한다. 횟수를 소진하면 batch를 멈춘다.
Gmail API·Attachment 다운로드는 실행하지 않으며 실제 분석 결과는 승인된 DB에 남긴다.

개별 실행도 가능하다.

```bash
node --test scripts/test-gmail.mjs
node scripts/test-google-connections.mjs
```

## 실제 Supabase 연결 검사 — 읽기 전용

```bash
npm run check:supabase
```

`.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`가 필요하다. Auth settings GET의 성공 여부만 검사하며 DB/RLS/로그인 사용자 세션 검증을 대신하지 않는다. Production 설정에서는 실행하지 않는다. PASS=exit 0, FAIL=exit 1, NOT RUN=exit 2다.

## 실제 Google Refresh 검사 — 명시적 실행

이 명령은 테스트 Connection의 저장 Token을 실제로 갱신한다. `npm test`나 다른 기본 검증에 포함되지 않는다. ai-hub-dev의 단일 connected Google 연결과 해당 소유자의 기존 Gmail 수집 이력이 필요하다.
사용자가 기존 테스트 연결을 명시 승인한 경우 `--existing-test-connection`은 이메일 입력 없이 단일 connected Google 연결과 저장 Gmail 이력으로 내부 식별한다. 복수 연결이면 실행하지 않는다.

필수 조건:

- Phase 4–5 서버 환경변수: Supabase URL/공개 키, 서버 Secret, Google Data OAuth 설정, 유효한 Token 암호화 키.
- `GMAIL_REFRESH_TEST_EMAIL`: 직접 지정한 테스트 이메일. Secret이 아니지만 저장소에 실제 값을 기입하지 않는다.
- `GMAIL_REFRESH_TEST_PROJECT`: `oclzdppdiljbojvqtkeu`. 스크립트는 실제 URL도 이 개발 프로젝트와 일치하는지 검사한다.

PowerShell 예시:

```powershell
$env:GMAIL_REFRESH_TEST_EMAIL = '테스트 계정 이메일'
$env:GMAIL_REFRESH_TEST_PROJECT = 'oclzdppdiljbojvqtkeu'
try {
  npm run test:live:google-refresh
} finally {
  Remove-Item Env:GMAIL_REFRESH_TEST_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:GMAIL_REFRESH_TEST_PROJECT -ErrorAction SilentlyContinue
}
```

만료 조건은 테스트 메모리에만 주입한다. Google refresh grant, 기존 암호화 RPC 저장, 새 Access Token의 Gmail profile 접근을 실제 실행한다. DB 만료 시각 위조, messages.list/get, Attachment 접근은 하지 않는다. CLI에서는 선택한 테스트 소유자를 확인한 뒤 auth/cookie adapter만 대체하므로 실제 Browser Cookie/로그인 검증과 구분한다. 오류 원문과 credential은 출력하지 않는다.

## 실제 Browser / DB Runtime 검증

로그인·Consent·수집·Library·Detail·Logout/Re-login은 현재 자동화된 npm script가 아니다. 개발 서버와 테스트 계정을 사용해 별도로 확인한다. 수집은 실제 Gmail을 읽고 ITEM 및 Connection sync 상태를 저장한다. 보고에는 count와 boolean만 사용한다.

DB Schema/RPC/RLS assertion과 Migration history 확인도 격리 테스트 결과로 대체하지 않는다. 기존 실제 검증 기록은 루트 `SPEC.md`, Migration 대응 관계는 `supabase/README.md`를 확인한다. 이번 테스트 명령 정리 자체는 Google refresh나 Browser 수집을 다시 실행했다는 의미가 아니다.

## Calendar-2 격리 검사

`npm test`에 test-calendar.mjs / test-calendar-oauth.mjs를 추가했다. 모든 Google/DB transport는 mock이다.
Event/date/timezone/all-day/recurring/canonical text/HTML/상한/retry/고정 정책/사용자 필터/부분 실패/취소 fresh 조회 및 사전 CAS 전달,
OAuth 목적 서명/권한 보존/부분 승인/다른 계정/stale/refresh/암호화 저장/Detail whitelist/API 입력 경계를 검증한다.
test-items.mjs는 실제 getItemDetail의 Calendar 원본 조회와 기존 Gmail/AI 계약 보존도 확인한다.
Scope/저장 SQL의 정적 안전 규칙과 Migration/검토 초안 일치를 확인한다. mock 결과를 실제 DB 저장/권한 PASS로 해석하지 않는다.

별도 `npm run test:isolated:calendar-sql`은 메모리 내 PostgreSQL/WASM 합성 검사다.
임시 테스트 도구 @electric-sql/pglite 0.3.14는 Git-ignored `supabase/.temp/calendar2-db`에 설치하며 제품 dependency에는 추가하지 않았다.
실행에 해당 임시 도구가 필요하며 기본 npm test에는 포함하지 않는다. 기본 테스트가 외부 설치/DB를 요구하게 만들지 않는다.
관련 enums/connections/items/unique key/updated_at trigger/token 구조는 기존 SQL에서 읽고, ancillary 보존 검사는 최소 sentinel tables를 사용한다.
두 신규 Migration을 오직 메모리 DB에 실행하여 create/reuse/update/CAS/stale/hash/취소/소유권/Scope/token/disconnect,
Scope upgrade rollback/checkpoint/timestamp/refresh 보존 및 service_role-only EXECUTE를 확인한다.
서비스 DB/ai-hub-dev/Google/Gemini/.env에 접근하지 않고 DB 파일을 생성하지 않는다. 실제 Supabase RLS/여러 세션 경합/브라우저 검증을 대체하지 않는다.
파서 pglast 8.5도 Git-ignored 임시 도구이며 SQL/PLpgSQL 검증에만 사용한다.
원격 Migration 적용, 실제 추가 동의 및 Event E2E는 Calendar-3 별도 승인 전 실행하지 않는다.

## Calendar-3 명시적 dev 검증

사용자가 두 Migration 및 실제 검증을 승인한 뒤에만 실행한다. `CALENDAR_DB_TEST_PROJECT=oclzdppdiljbojvqtkeu`가 필요하다.
`calendar-dev-db.mjs`는 Supabase CLI Management API 결과를 내부 파싱하고 query/row/raw error를 출력하지 않는다.

- `node scripts/apply-calendar-dev.mjs`: 적용 전 이력·초안 동일·함수만 변경인지 확인하고 기존 데이터/구조 hash 캡처.
  `--apply`는 승인된 두 파일만 동일 transaction으로 적용/history 등록 후 해시 보존 확인. 이미 등록된 경우 재적용하지 않는다.
- `node scripts/verify-calendar-dev.mjs`: 원격 함수 본문/보안/권한과 두 이력의 version/name/statements 정확한 로컬 일치 읽기 검증.
- `node scripts/test-calendar-db.mjs`: 실제 dev PostgreSQL 합성 RPC/RLS 검증. auth.users·ITEM·분석 fixture는 전체 rollback.
- `node scripts/test-calendar-live.mjs --before-consent`: credential 없이 연결과 기존 데이터 hash를 Git-ignored `.temp`에 캡처.
  옵션 없는 실행은 동의 후 저장된 실제 Scope/refresh bundle/동일 계정·checkpoint 보존을 검사한다.
- `node scripts/test-calendar-live.mjs --collect-one`: API 활성화 및 사용자 직접 동의 후 실제 primary Event **1건만** 저장.
  production 정책의 최초 1페이지에서 적격 일정 1건을 선택하고 내부 ID만 `.temp`에 고정하며 재시도 때 대상을 늘리지 않는다.
  production client/validation/collector/RPC를 실행하되 CLI auth/cookie 및 단일 Event selection adapter는 대체한다.
  같은 Event를 실제 GET으로 다시 확인한 뒤 재처리의 DB 행 불변/중복 없음, mapping/Library/Detail/whitelist와 실제 ITEM owner/foreign/anon RLS를 확인한다.
  Browser collect HTTP/UI 또는 Google 원본 변경에 따른 실제 update/cancel 검증을 대체하지 않는다.
  제목/본문/PII/credential/provider payload 출력, Google 원본 변경, Gemini 호출 없음.

신규 검증 스크립트는 기본 npm test에 포함하지 않는다. 실제 API/OAuth/Event 검증 전 상태를 COMPLETE로 보고하지 않는다.


## Upload-2 격리 검증

`npm test`의 test-upload.mjs는 generated PDF text/scan/mixed·PNG/JPEG 실제 decoder/격리 child와
mock Vision/Storage/RPC를 사용한다. 로컬 사용자 파일·실제 upload·Vision·Google 호출 없음.
MIME/경로/상한/손상/암호화/active PDF/빈 또는 초과 text/실패/stale/download ownership/HTTP/비노출을 검사한다.
기존 test-items는 upload Detail whitelist를 검증한다.

`npm run test:isolated:upload-sql`: Git-ignored `supabase/.temp/calendar2-db` PGlite 0.3.14로
신규 draft SQL을 ephemeral PostgreSQL에 실행한다. 기존 실제 enum 및 ITEM constraints/triggers를 재사용하고
Storage/Auth mock catalog의 실제 role/RLS, service-only 권한, 중복/identity/idempotency/실패/CAS/global reservation/정리를 확인한다.
Classification/Action/Evidence는 보존 sentinel이며 production ancillary RLS 또는 원격 동시 경합 검증이 아니다.
환경변수/실제 DB/Storage/credentials를 읽거나 변경하지 않는다. pglast 8.5는 catalog rowtype를 record로 표현해 별도 구문 검사했다.

Upload-2 dependency audit: 실행 의존성 `npm audit --omit=dev` 0건; 기존 braces 3.0.3를 경유한
ESLint/shadcn/ts-morph 개발 의존성 high 8건은 기록만 하고 요청 범위 밖 major downgrade/force fix는 하지 않았다.


## Upload-3 승인된 dev 검증

기존 helper를 재사용하므로 `CALENDAR_DB_TEST_PROJECT=oclzdppdiljbojvqtkeu` guard가 필요하다.
Upload 적용/Storage 검증은 추가로 `UPLOAD_DB_TEST_PROJECT=oclzdppdiljbojvqtkeu`를 요구한다.
- `apply-upload-dev.mjs`: exact draft/history/pre-existing object/data baseline 읽기 검사.
  명시적 `--apply`만 승인된 한 건 적용/history 등록. 재적용 없음; Production 금지.
- `verify-upload-dev.mjs`: local/remote version/name/statements 및 함수 본문/보안의 exact read 비교.
- `test-upload-db.mjs`: 실제 DB 합성 사용자/RPC/RLS/분석 sentinel transaction 전체 rollback.
  `--save-sql`은 합성 transaction 텍스트를 ignored temp에 준비할 뿐 원격 호출 없음.
- `test-upload-storage.mjs`: 실제 Auth principal/Storage signed 및 authenticated API 및 product
  Original route handler/Library/Detail. CLI session adapter를 사용하며 Browser HTTP E2E를 주장하지 않는다.
  exact synthetic objects→synthetic Auth users 순서로 정리. 실제 OCR/AI 호출 없음.
- `test-upload-regression.mjs`: 이미 저장된 한 Doc UUID를 내부 조회해 기존 Drive 검증 재사용.
  external_id/payload는 출력하지 않는다. userId 또는 임의 파일 목록으로 대상을 확대하지 않는다.
- `upload-preflight.mjs`: credential/path 내용 없이 runtime 존재 여부 boolean만 출력한다.
- `upload-e2e-fixtures.mjs`: ignored synthetic 작은 text PDF/문자 PNG 생성만 수행. 업로드/OCR 아님.

아래 ADC/Cloud worker 스크립트는 기존 정책의 이력이며 현재 브라우저 OCR MVP에서는 실행하지 않는다.
현재 실행 조건과 실제/fixture 결과 구분은 docs/PROJECT_STATE.md 및 UPLOAD_RUNTIME_SETUP.md 참조.

ADC 완료 후 `check-upload-adc.mjs`는 client/access token/quota project 준비 상태 boolean만 출력한다.
`prepare-upload-worker.ps1`은 8개 파일 allowlist source context를 새 ignored 디렉터리에 만든다.
`deploy-upload-worker.ps1`은 기본 billing read 검사, `-Apply`는 준비된 source/private IAM/attached SA/
Direct VPC 및 firewall 배포. billing false에서는 cloud 변경 전에 정지한다. 결제 설정 변경이나 key 생성은 없다.
`test-upload-worker-entrypoint.mjs`는 localhost의 실제 HTTP parser entrypoint를 synthetic PDF로 검사하고
서버를 종료한다. Vision/OCR/사용자 파일/Google provider 호출 없음. Cloud Run smoke를 대체하지 않는다.

### Upload-3 browser OCR / Migration 적용 전

- `prepare-upload-assets.mjs` / `npm run prepare:upload-assets`: pinned Worker/WASM/PDF worker 복사,
  kor/eng language gzip download + committed SHA256 검증. `prebuild` 자동 실행, no OCR.
  `.gitignore`의 `public/ocr`에는 생성 asset만, Git에는 작은 version/hash manifest만 저장.
- `test-upload-browser.mjs`: Worker protocol/provider abstraction/순차 처리/cancel/재접속 흐름 mock 및
  페이지 조작/metadata/control/길이 검증. 실제 브라우저 OCR 정확성 검증을 대체하지 않음.
- `check-upload-build.mjs`: local production HTTP anonymous prepare/complete, asset CSP/cache 및
  native/module tracing/표준 function 크기 검사. 실제 Vercel 배포/native Linux 실행과 구분.
- `write-upload-rpc-draft.mjs`: 적용된 Migration을 읽어 새 function-only draft를 재현한다.
  DB 접속/적용 없음. 기존 SQL 수정 없음. `test:isolated:upload-sql`은 원본+후속 draft를 ephemeral DB에서 검증.
- `upload-e2e-fixtures.mjs`: text PDF/한영 PNG·JPEG/scanned·mixed PDF 생성만. 실제 파일업로드/OCR 없음.
  새 RPC 원격 적용 승인 뒤 production prepare/browser OCR/complete/Library/Detail/original/RLS E2E를 수행한다.

### Upload-3 dev 적용 및 최소 실제 E2E 완료

- `apply-upload-provider-dev.mjs --apply`: 승인된 provider-neutral Migration 한 건만 적용.
  CALENDAR_DB_TEST_PROJECT/UPLOAD_DB_TEST_PROJECT 모두 dev ref일 때만 실행, 승인 SHA256/원래 RPC/history
  확인 및 데이터/Storage/schema 보존 비교. 일반 db push/history repair/reset을 사용하지 않는다.
- `verify-upload-dev.mjs`: 기존 Migration history와 신규 history를 모두 보존하면서 현재 RPC 본문 검증.
- `verify-upload-browser-dev.mjs`: 실제 UI 업로드한 합성 PDF/PNG의 text/hash/origin/ranges/dedupe와
  기존 Google 데이터 해시 비교. ignored `supabase/.temp/upload3-browser-item-ids.json`의 pdf/png UUID 및
  apply script가 기록한 ignored baseline 필요. 본문/token/signed URL 출력 없음.
- `verify-upload-stored-reads.mjs`: 기존 Google owner를 지정한 service-client adapter로 production
  Library/Detail 저장 데이터 조회. Google API refresh/collect 및 Gemini 호출 없음.
- 실제 browser UI에서 PDF, 한영 PNG OCR 및 동일 PNG reuse/Library/Detail 확인 PASS.
  실제 Storage/RLS는 test-upload-storage.mjs로 owner/foreign/anon 검증 후 합성 데이터만 정리.
- Upload COMPLETE, Search/Embedding 미착수. 실제 Vercel/Linux·모바일 성능은 후속 TODO.

## Search-3 마감

`scripts/verify-search-closeout.mjs`는 명시한 ai-hub-dev에서 기존 public connection 상태/checkpoint,
source ITEM count와 과거 비민감 identity/locator/AI·ACT/OCR/원본 Storage 존재만 읽기 전용으로 확인한다.
`SEARCH_CLOSEOUT_PROJECT=oclzdppdiljbojvqtkeu` 지정 후 실행한다. Google Token 테이블/RPC/refresh 및 파생값 비교 없음.
합성 E2E는 이미 PASS했고 정리됐으므로 일반 build/test와 마감 검사에서 자동 재실행하지 않는다.
현재 결과/한계는 docs/PROJECT_STATE.md 17절과 docs/SEARCH_GOLDEN.md를 따른다.
