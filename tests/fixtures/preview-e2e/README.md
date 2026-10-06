# Preview 합성 이미지

`synthetic-preview-e2e.png`는 개인자료가 없는 한국어/영어 OCR 및 실제 AI 분석용 이미지다. 생성 후 육안으로 확인했다. Mock AI 응답이나 저장된 분석 결과가 아니다.

- 크기: 1700 × 720, PNG, 107651 bytes
- SHA256: `12b0855e93947172b0fb5f0ba352033819c73784315559e0c5cdc0d564c25b2d`
- 원문: synthetic sample form 제출 의무, 제출 마감 December 31, 2026, 필요 서류 synthetic sample application form, 적용 대상 synthetic test participants.
- 행사: information session January 10, 2027. 행사 날짜는 제출 마감이 아니라고 명시한다.

검증: 새 파일로 업로드 → 실제 브라우저 OCR → 저장 → 실제 Gemini 분석 → Detail 재조회. 한글/영문 추출, 제출 의무 및 마감 `2026-12-31`, 추적 가능한 원문 Evidence를 확인한다. 행사 날짜를 마감으로 바꾸거나 행사 참석 Action을 근거 없이 생성하면 FAIL이다. Action의 자연어 표현은 일치할 필요가 없다. OCR 오인식은 원문과 비교해 기록하며 임의 보정한 결과로 성공을 판정하지 않는다.

같은 파일을 이미 업로드했다면 hash 중복 재사용이 정상이다. 재사용 성공은 신규 OCR 실행의 증거가 아니므로 최초 실행/재사용을 구분한다. 분류 수정값은 분석 재실행으로 덮어쓰면 안 된다. 합성 Action은 서비스 내부의 테스트이며 실제 제출을 수행하지 않는다.

이 파일은 이번 준비 단계에서 업로드하거나 분석하지 않았다. 실행 절차는 `docs/PREVIEW_FINAL_E2E_CHECKLIST.md`를 따른다.
