# Upload 및 브라우저 OCR 실행 안내

`20261005093526_upload_provider_neutral_rpc.sql`은 사용자 승인 후 **ai-hub-dev 적용 완료**다.
기존 private upload-originals/session/RLS/Migration을 유지하고 provider-neutral RPC만 교체했다.
다른 환경에 이 코드를 배포하려면 해당 환경에도 승인된 RPC Migration을 먼저 적용해야 한다.

MVP: text PDF=server PDF.js; image=browser Tesseract.js; scanned PDF=browser PDF.js render + Tesseract.js.
Cloud Vision/Cloud Run/Billing/OCR ADC/UPLOAD_WORKER_URL 불필요. 기존 ADC/Google OAuth는 그대로 둔다.
Gemini OCR은 향후 선택적 provider TODO이고 자동 fallback/실제 Gemini 호출 없음.

## 로컬 준비

Node >=22.13, `npm ci`, `npm run prepare:upload-assets`, `npm run dev`.
`npm run build`는 prebuild에서 asset 준비/검증을 자동 실행한다.
Tesseract.js 7.0.0/core 7.0.0, PDF.js 6.4.299와 lockfile을 고정한다.
Worker/WASM/PDF worker는 설치 package에서 복사하고 kor/eng은 공식 버전 고정 language package
1.0.0의 best_int gzip에서 준비한다. URL/SHA256/size는 workers/upload/browser-assets.json.
필수 asset이 없거나 hash가 다르면 build를 실패시킨다. Git에는 바이너리/언어 데이터 대신 manifest/script만 저장한다.
초기 build는 network가 필요하고 이후 hash 일치 local asset은 재사용한다. Runtime은 same-origin asset만 사용한다.
`--record-hashes`는 새로운 모델을 의도적으로 검토할 때만 쓰며 일반 build에서는 쓰지 않는다.

## 동작

Library에는 기능용 파일 선택/업로드/진행/취소/재시도/새 파일만 연결했다. 디자인 작업은 하지 않았다.
prepare는 원본 검증/pending/dedupe 이후 OCR page 번호만 반환하고 lease를 해제한다.
text PDF는 prepare에서 서버 결과로 완료하며 Tesseract를 로딩하지 않는다.
브라우저는 owner signed original을 받아 한 Worker/kor+eng/cache로 OCR 페이지를 순차 처리한다.
scan PDF는 서버 plan의 해당 페이지만 200DPI render; API로 raster를 보내지 않는다.
complete는 원본/plan 재검증, client text whitelist/한계 검증, 서버 NFC/hash/range 계산 후 새 attempt/CAS 저장.
모든 필수 페이지 성공 전에는 부분 text를 정상 저장하지 않는다.

브라우저 중단 시 localStorage에는 사용자별 upload UUID/idempotency key만 남긴다.
원본 URL/text/token은 저장하지 않는다. 재접속은 owner 검증된 prepare와 새 signed URL을 사용한다.
OCR 실패/탭 종료는 즉시 server failed가 아니다. 취소가 완료 제출 이후이면 서버 commit이 이미 진행될 수 있으며
다음 prepare의 reuse로 실제 결과를 확인한다. stored/failed session은 재시도 가능; pending 최초 준비는 15분 기한.
원본 Storage 성공 후 응답 유실 또는 저장 실패는 같은 session/key의 재시도로 복구한다.

## 검증 및 남은 조건

- npm test / typecheck / lint / build / check:supabase / git diff --check.
- test:isolated:upload-sql은 ephemeral DB, remote 적용이 아니다.
- check-upload-build.mjs는 localhost production tracing/asset/CSP/anonymous HTTP만.
- upload-e2e-fixtures.mjs는 개인정보 없는 text PDF/한영 PNG·JPEG/scanned·mixed PDF 생성만.
- 실제 브라우저에서 text PDF 1건(server PDF.js, OCR 0회), 한영 PNG 1건(Tesseract.js kor+eng),
  동일 PNG 재업로드/ITEM reuse 및 Library/Detail PASS. 실제 Storage HTTP/RLS 소유자·타 사용자·익명 경계 PASS.
- 실제 Vercel/Linux parser/native memory/time 및 모바일 Android/iOS 성능은 후속 TODO다.
  로컬 브라우저 Worker/WASM/kor-eng 실제 OCR 성공을 배포·모바일 검증으로 확대하지 않는다.

5MB/10페이지는 허용 상한이며 모바일 처리 보장이 아니다. 한 페이지씩 canvas/bitmap 해제,
한 OCR Worker, 초기화 및 job timeout 120초, cancel/오류 시 terminate. 모바일 background 중단/메모리 부족은
실패·재시도로 안내하며 파일/text를 truncate하지 않는다. PDF.js render Worker와 OCR Worker는 각각 1개이며
OCR 엔진 병렬 Worker는 만들지 않는다.

브라우저 OCR은 untrusted client input이다. providerVersion/confidence는 참고 보고값이고 engine 실행 증명이 아니다.
검색/AI/Evidence 정확성에 원본과의 불일치 위험이 남으며 원문 highlight는 후속 TODO.
production에서 필요 시 Cloud Vision/Gemini 등 managed provider를 별도 승인으로 추가할 수 있다.
