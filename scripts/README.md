# 빌드·배포·운영 도구

프로젝트 root에서 실행한다. 테스트 실행 파일은 `tests/`, 보조 로더·합성 자료는 `tests/helpers/`, 타입 검사는 `tests/types/`에 분리했다.

검사 명령과 실연결 주의사항은 [테스트 안내](../tests/README.md)를 따른다. 기본 `npm test`는 기존 격리 실행 목록을 유지한다.

## 검색 운영

`search-backfill.mjs`는 build/test에서 자동 실행하지 않는다. 사용자·전송 범위 승인 후에만 실행한다. 실행당 최대 5 ITEM이며 기본 lexical-only다. `--resume`은 기존 진행 기록을 이어간다.

`--semantic-non-sensitive`는 서버 설정과 해당 batch 전체의 allowlist 조건을 충족해야 한다. 개인자료 전체 backfill은 별도 승인 없이 실행하지 않는다. 실패 budget·quota·진행 상태는 스크립트와 검색 계약을 따른다.

검색 검증 기준: [SEARCH_VALIDATION.md](../docs/setup/SEARCH_VALIDATION.md).

## Upload 도구

- `prepare-upload-assets.mjs`: 고정 manifest의 OCR Worker·WASM·언어·PDF 자산 준비와 hash 검사. `prebuild`에서 사용.
- `check-upload-build.mjs`, `tests/test-upload-worker-entrypoint.mjs`: 자산·Worker 계약 검사.
- `upload-preflight.mjs`, `check-upload-adc.mjs`: 선택적 parser/provider 환경의 사전 검사. 실행 전 외부 접근 범위 확인.
- `upload-e2e-fixtures.mjs`: 반복 E2E용 합성 PDF·이미지 준비. 출력은 ignored 임시 영역.
- `tests/helpers/upload-fixtures.mjs`, `tests/helpers/analysis-fixtures.mjs`: 테스트가 사용하는 합성 자료 helper.
- `prepare-upload-worker.ps1`, `deploy-upload-worker.ps1`: Worker 준비·배포 도구. IAM 대상은 `-IamMemberEmail` 또는 `UPLOAD_WORKER_IAM_MEMBER_EMAIL`로 전달. 실제 배포는 별도 승인 후 실행.

설정·제한: [UPLOAD_RUNTIME_SETUP.md](../docs/setup/UPLOAD_RUNTIME_SETUP.md). 브라우저 검증: [E2E_CHECKLIST.md](../docs/setup/E2E_CHECKLIST.md).

## 개발 DB 관리 도구

`apply-calendar-dev.mjs`, `apply-upload-dev.mjs`, `apply-upload-provider-dev.mjs`는 이름 그대로 개발 DB 적용 도구다. 자동 테스트에 포함하지 않으며 DB 변경 승인 없이 실행하지 않는다.

`verify-calendar-dev.mjs`, `verify-upload-dev.mjs`, `verify-upload-browser-dev.mjs`는 특정 개발 환경의 함수·검증 checkpoint를 확인한다. 일부 도구는 ignored 임시 기록에 의존하므로 새 환경에서 바로 실행할 수 있다고 가정하지 않는다.

`calendar-dev-db.mjs`, `google-live-loader.mjs`와 `tests/helpers/`의 로더는 검증 코드가 공유하는 연결·모듈 로더다. 앱의 실제 서비스 코드를 대체하지 않는다.
