# 테스트 실행 안내

프로젝트 루트에서 실행한다. 기본 `npm test`는 외부 서비스와 실제 DB에 접근하지 않는 격리 테스트만 실행한다. 실연결 검사는 별도 명령으로 실행하며 Secret, Token, JWT 또는 메일 원문을 출력하지 않는다.

## 명령과 영향 범위

| 명령 | 실행 파일 / 범위 | 외부 서비스 | 실제 DB 변경 |
| --- | --- | --- | --- |
| `npm test` 또는 `npm run test:isolated` | 아래 5개 격리 테스트 | 없음 | 없음 |
| `npm run lint` | ESLint | 없음 | 없음 |
| `npm run typecheck` | TypeScript | 없음 | 없음 |
| `npm run build` | Next.js build | 현재 구현에서 없음 | 없음 |
| `npm run check:supabase` | `check-supabase.mjs` | Supabase Auth 설정 GET | 없음 |
| `npm run test:live:google-refresh` | `test-gmail-refresh-live.mjs` | 개발 Supabase 및 Google token/profile API | 테스트 계정의 암호화 Token bundle 갱신 |
| `npm run test:live:analysis-db` | `test-analysis-db.mjs` | 개발 Supabase | 합성 데이터 transaction 후 전체 rollback |
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

Fixture는 메모리에 있으며 실제 메일, Secret 또는 DB 연결이 필요하지 않다. Google Connection 파일은 기존 assertion suite를 하나의 파일 단위 테스트로 실행한다. Phase 6A는 9개 개별 검사를 추가한다.

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

이 명령은 테스트 Connection의 저장 Token을 실제로 갱신한다. `npm test`나 다른 기본 검증에 포함되지 않는다. ai-hub-dev에 connected 상태인 계정이 있어야 하며, 현재 스크립트는 서비스 로그인 이메일과 Data Connection 이메일이 같은 테스트 계정만 허용한다.

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
