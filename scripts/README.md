# 테스트·운영 도구

프로젝트 root에서 실행한다. 기본 격리 테스트와 실제 서비스에 접근하는 도구를 구분한다. Secret·토큰·개인자료를 출력하거나 fixture에 저장하지 않는다.

## 기본 검사

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

- `npm test` / `npm run test:isolated`: `package.json`에 지정된 격리 회귀 suite. 실제 DB·Google·Gemini에 접근하지 않는다.
- `npm run test:search`: 검색·오류 처리 격리 검사.
- `node --test scripts/test-manual-item.mjs`: 직접 입력의 별도 격리 회귀 검사.
- `scripts/type-tests/item-detail-contract.ts`: `npm run typecheck`가 포함하는 컴파일 전용 계약 검사.
- `npm run build`: `prebuild`에서 OCR 자산을 준비한다. 최초 자산 준비는 네트워크가 필요할 수 있다.

Auth, Gmail, Drive, Calendar, Upload/OCR, 분석, 검색, UI, Sync, Action 계약의 격리 검사는 `test-*.mjs`에 있으며 정확한 기본 실행 목록은 `package.json`을 따른다.

## 오프라인 SQL 검사

```bash
node scripts/test-calendar-sql.mjs
node scripts/test-upload-sql.mjs
node scripts/test-search-sql.mjs
node scripts/test-gap-sql.mjs
```

임시 메모리 PostgreSQL/PGlite에서 실행하며 원격 DB에는 연결하지 않는다. 현재 도구는 Git에서 제외된 `supabase/.temp/calendar2-db/node_modules/@electric-sql/pglite` 실행 환경을 사용한다. 이 선택적 SQL 검증 환경은 `npm ci`만으로 설치되지 않는다. 기본 `npm test`와 구분한다.

- 초기 SQL: `supabase/baseline/`
- 변경 SQL: `supabase/migrations/`
- 테스트 검토 SQL: [tests/fixtures/sql](../tests/fixtures/sql/README.md)

적용된 Migration·baseline·fixture 본문을 검증 편의를 위해 수정하거나 원격에 자동 적용하지 않는다.

## 실연결 검사

`test-*-live.mjs`, `test-*-db.mjs`, Storage 검사 등은 별도 개발 환경·인증·실행 승인이 필요하다. 실행 전 각 파일의 project guard, 환경변수, 생성·변경·정리 범위를 확인한다. 격리 테스트 PASS를 실제 OAuth·RLS·AI·OCR E2E 성공으로 간주하지 않는다.

| 도구 | 영향 범위 |
| --- | --- |
| `check-supabase.mjs` | 공개 Auth 설정·연결 확인. 실제 DB/RLS E2E 대체 불가 |
| `test-gmail-refresh-live.mjs` | 실제 Google refresh/profile 및 연결 Token 갱신 |
| `test-analysis-live.mjs`, `test-drive-live.mjs`, `test-calendar-live.mjs` | 실제 수집 또는 AI 분석. 데이터·provider 호출 가능 |
| `test-analysis-db.mjs`, `test-drive-oauth-db.mjs`, `test-drive-db.mjs`, `test-calendar-db.mjs`, `test-upload-db.mjs`, `test-gap-live.mjs` | 파일별 guard가 있는 실제 개발 DB 계약 검사 |
| `test-upload-storage.mjs` | 실제 Storage·RLS 검사와 합성 데이터 정리 |
| `test-search-live.mjs`, `test-search-backfill-live.mjs` | 합성 사용자·검색 자료·실제 provider 또는 DB 변경 가능 |
| `test-search-stored-regression.mjs` | 기존 자료의 Library·Detail·keyword 계약 읽기 검사. 개인 query/text는 외부 provider에 전송하지 않음 |
| `test-upload-regression.mjs`, `verify-upload-stored-reads.mjs` | 기존 연결·저장 자료의 회귀 검사. 실행 전 해당 환경의 전제 확인 |

## 검색 운영

`search-backfill.mjs`는 build/test에서 자동 실행하지 않는다. 사용자·전송 범위 승인 후에만 실행한다. 실행당 최대 5 ITEM이며 기본 lexical-only다. `--resume`은 기존 진행 기록을 이어간다.

`--semantic-non-sensitive`는 서버 설정과 해당 batch 전체의 allowlist 조건을 충족해야 한다. 개인자료 전체 backfill은 별도 승인 없이 실행하지 않는다. 실패 budget·quota·진행 상태는 스크립트와 검색 계약을 따른다.

검색 검증 기준: [SEARCH_VALIDATION.md](../docs/setup/SEARCH_VALIDATION.md).

## Upload 도구

- `prepare-upload-assets.mjs`: 고정 manifest의 OCR Worker·WASM·언어·PDF 자산 준비와 hash 검사. `prebuild`에서 사용.
- `check-upload-build.mjs`, `test-upload-worker-entrypoint.mjs`: 자산·Worker 계약 검사.
- `upload-preflight.mjs`, `check-upload-adc.mjs`: 선택적 parser/provider 환경의 사전 검사. 실행 전 외부 접근 범위 확인.
- `upload-e2e-fixtures.mjs`: 반복 E2E용 합성 PDF·이미지 준비. 출력은 ignored 임시 영역.
- `upload-fixtures.mjs`, `analysis-fixtures.mjs`: 테스트가 사용하는 합성 자료 helper.
- `prepare-upload-worker.ps1`, `deploy-upload-worker.ps1`: Worker 준비·배포 도구. IAM 대상은 `-IamMemberEmail` 또는 `UPLOAD_WORKER_IAM_MEMBER_EMAIL`로 전달. 실제 배포는 별도 승인 후 실행.

설정·제한: [UPLOAD_RUNTIME_SETUP.md](../docs/setup/UPLOAD_RUNTIME_SETUP.md). 브라우저 검증: [E2E_CHECKLIST.md](../docs/setup/E2E_CHECKLIST.md).

## 개발 DB 관리 도구

`apply-calendar-dev.mjs`, `apply-upload-dev.mjs`, `apply-upload-provider-dev.mjs`는 이름 그대로 개발 DB 적용 도구다. 자동 테스트에 포함하지 않으며 DB 변경 승인 없이 실행하지 않는다.

`verify-calendar-dev.mjs`, `verify-upload-dev.mjs`, `verify-upload-browser-dev.mjs`는 특정 개발 환경의 함수·검증 checkpoint를 확인한다. 일부 도구는 ignored 임시 기록에 의존하므로 새 환경에서 바로 실행할 수 있다고 가정하지 않는다.

`calendar-dev-db.mjs`, `analysis-loader.mjs`, `calendar-loader.mjs`, `google-live-loader.mjs`, `search-loader.mjs`는 검증 코드가 공유하는 연결·모듈 로더다. 앱의 실제 서비스 코드를 대체하지 않는다.
