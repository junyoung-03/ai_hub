# 테스트 안내

프로젝트 root에서 실행한다. 기본 격리 테스트와 실제 서비스에 접근하는 도구를 구분한다. Secret·토큰·개인자료를 출력하거나 fixture에 저장하지 않는다.

## 파일 구성

- `tests/test-*.mjs`: 기능별 테스트. 격리·SQL·실연결 검사를 포함하므로 이름만 보고 전체 실행하지 않는다.
- `tests/helpers/`: 격리 실행 로더와 합성 자료 생성 도구.
- `tests/types/`: 컴파일 전용 타입 계약 검사.
- `tests/fixtures/`: 기존 SQL·합성 이미지 자료.
- 빌드·배포·데이터 관리 도구는 [scripts](../scripts/README.md)에 둔다.

## 기본 검사

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

- `npm test` / `npm run test:isolated`: `package.json`에 지정된 격리 회귀 suite. 실제 DB·Google·Gemini에 접근하지 않는다.
- `npm run test:search`: 검색·오류 처리 격리 검사.
- `node --test tests/test-manual-item.mjs`: 직접 입력의 별도 격리 회귀 검사.
- `tests/types/item-detail-contract.ts`: `npm run typecheck`가 포함하는 컴파일 전용 계약 검사.
- `npm run build`: `prebuild`에서 OCR 자산을 준비한다. 최초 자산 준비는 네트워크가 필요할 수 있다.

Auth, Gmail, Drive, Calendar, Upload/OCR, 분석, 검색, UI, Sync, Action 계약의 격리 검사는 `test-*.mjs`에 있으며 정확한 기본 실행 목록은 `package.json`을 따른다.

## 오프라인 SQL 검사

```bash
node tests/test-calendar-sql.mjs
node tests/test-upload-sql.mjs
node tests/test-search-sql.mjs
node tests/test-gap-sql.mjs
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
| `scripts/check-supabase.mjs` | 공개 Auth 설정·연결 확인. 실제 DB/RLS E2E 대체 불가 |
| `test-gmail-refresh-live.mjs` | 실제 Google refresh/profile 및 연결 Token 갱신 |
| `test-analysis-live.mjs`, `test-drive-live.mjs`, `test-calendar-live.mjs` | 실제 수집 또는 AI 분석. 데이터·provider 호출 가능 |
| `test-analysis-db.mjs`, `test-drive-oauth-db.mjs`, `test-drive-db.mjs`, `test-calendar-db.mjs`, `test-upload-db.mjs`, `test-gap-live.mjs` | 파일별 guard가 있는 실제 개발 DB 계약 검사 |
| `test-upload-storage.mjs` | 실제 Storage·RLS 검사와 합성 데이터 정리 |
| `test-search-live.mjs`, `test-search-backfill-live.mjs` | 합성 사용자·검색 자료·실제 provider 또는 DB 변경 가능 |
| `test-search-stored-regression.mjs` | 기존 자료의 Library·Detail·keyword 계약 읽기 검사. 개인 query/text는 외부 provider에 전송하지 않음 |
| `test-upload-regression.mjs`, `scripts/verify-upload-stored-reads.mjs` | 기존 연결·저장 자료의 회귀 검사. 실행 전 해당 환경의 전제 확인 |

실연결 검사는 기본 `npm test`에 포함하지 않는다. 실행 전 파일별 guard와 승인 조건을 확인한다.
