# AI 통합 정보 허브

Gmail·Google Drive·Google Calendar와 직접 추가한 자료를 한곳에서 검색하고, AI가 찾은 할 일·마감·일정을 원문 근거와 함께 확인하는 웹 서비스입니다.

## 주요 기능

- Gmail, Google Drive, Google Calendar 연결 및 수집
- PDF·이미지 업로드, 텍스트 추출·OCR, 직접 텍스트 입력
- Gemini 기반 분류·Action·Deadline·Event 분석과 사용자 분류 수정
- 자연어 통합검색, Keyword / Semantic / Hybrid Search
- 검색 결과의 Source·Evidence 확인과 자료 상세 보기
- 임박한 마감, 할 일 상태 관리, 월간 캘린더

지원 파일·수집 범위와 분석 제한은 [서비스 명세](docs/SPEC.md)를 따릅니다. Semantic Search는 환경 설정과 전송 허용 범위에 따라 동작합니다.

## 서비스

[Production 서비스](https://ai-hub-one-ebon.vercel.app/) · [개인정보 처리방침](https://ai-hub-one-ebon.vercel.app/privacy) · [이용약관](https://ai-hub-one-ebon.vercel.app/terms)

## Tech Stack

| 영역 | 기술 |
| --- | --- |
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Next.js Route Handlers, Upload parser worker |
| Database / Auth / Storage | Supabase PostgreSQL, pgvector, Supabase Auth·Storage |
| AI | Gemini 분석·Embedding |
| Google APIs | OAuth 2.0, Gmail, Drive, Calendar |
| Deployment | Vercel, Google Cloud Run |

## Architecture

```text
Gmail / Drive / Calendar / Upload / Manual Text
                    ↓
               Unified ITEM
                    ↓
                AI Analysis
                    ↓
          Search / Action / Calendar
                    ↓
              Source + Evidence
```

입력 경로가 달라도 Unified ITEM으로 처리합니다. 행사 날짜와 실제 제출·신청 마감은 구분하며, 사용자 수정값은 AI 재분석보다 우선합니다.

## Local Development

Node.js 22.13 이상과 npm이 필요합니다. Supabase 및 Google OAuth·API, Gemini를 사용할 경우 해당 개발 환경도 준비해야 합니다.

```bash
npm ci
```

프로젝트 root의 `.env.example`을 `.env.local`로 복사하고 개발용 값을 설정합니다. 실제 비밀값을 Git에 추가하지 마세요.

```bash
npm run prepare:upload-assets
npm run dev -- -p 3001
```

브라우저에서 [http://localhost:3001](http://localhost:3001)을 엽니다. 기본 포트로 실행하려면 `npm run dev`를 사용합니다. Google 연결 callback URI는 실행 포트 및 등록한 개발용 OAuth URI와 일치해야 합니다.

## Environment Variables

변수 목록과 기본값은 [.env.example](.env.example)을 기준으로 합니다.

| 용도 | 주요 변수 |
| --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, 서버 전용 `SUPABASE_SECRET_KEY` |
| Google 데이터 연결 | `GOOGLE_DATA_CLIENT_ID`, `GOOGLE_DATA_CLIENT_SECRET`, `GOOGLE_DATA_REDIRECT_URI`, `GOOGLE_DATA_TOKEN_ENCRYPTION_KEY` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Upload / OCR | `UPLOAD_WORKER_URL`, `UPLOAD_OCR_ENABLED`, `GOOGLE_CLOUD_PROJECT` |
| Search | `SEARCH_SEMANTIC_ENABLED`, `SEARCH_NON_SENSITIVE_ITEM_IDS`, `SEARCH_CURSOR_SECRET` |

Secret·암호화 키·서버 키는 서버 환경에서만 사용합니다. Upload/OCR의 실행 조건과 자산 준비는 [Upload 설정 안내](docs/setup/UPLOAD_RUNTIME_SETUP.md)를 확인하세요. `prebuild`는 OCR 자산을 준비하며 생성된 `public/ocr/`는 Git에서 제외합니다.

## Database

- `supabase/baseline/`: 초기 remote DB 구성을 설명하는 SQL 보관본입니다.
- `supabase/migrations/`: 이후 변경 Migration입니다.

**현재 Migration 폴더만으로 완전한 fresh database bootstrap을 보장하지 않습니다.** 초기 두 이력은 remote-only로 기록되어 있으며, baseline을 신규 Migration으로 자동 재적용하면 안 됩니다. 새 개발 DB 구성은 [SQL·Migration 안내](supabase/README.md)를 먼저 확인하세요.

## Tests

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test`는 외부 서비스·실제 DB에 접근하지 않는 격리 테스트입니다. 실연결·SQL·저장 데이터 검증은 [테스트 안내](scripts/README.md)에 별도로 설명되어 있습니다. 실제 데이터 변경이나 AI 호출을 하는 스크립트는 영향 범위를 확인한 뒤 실행해야 합니다.

## Repository Structure

```text
src/                       화면, API, 서비스 로직, 타입
public/                    정적 자산·폰트·라이선스
supabase/baseline/         초기 SQL 보관본
supabase/migrations/       이후 변경 Migration
workers/upload/            Upload parser·OCR 관련 자산 설정
scripts/                   테스트·검증·운영 도구
tests/fixtures/            합성 OCR 자료·SQL 테스트 fixture
docs/SPEC.md               서비스·개발 명세
docs/api/                  API 계약
docs/ai/                   AI 출력 규칙
docs/architecture/         현재 설계 근거
docs/setup/                실행·OCR·E2E 검증 안내
AI_OUTPUT_SCHEMA.json      실행 코드가 사용하는 AI JSON Schema
AGENTS.md                  에이전트 개발 지침
```

## Security / Data

- 비밀값은 `.env.local` 또는 배포 환경의 Secret으로 관리하며 저장소에 커밋하지 않습니다.
- Google 원본은 Google에 유지하며, 현재 연동은 원본 읽기용입니다. 서비스 데이터 삭제가 Google 원본 삭제로 이어지지 않습니다.
- Google 연결 해제 시 신규 동기화를 중단하고 기존 분석·검색·Action 데이터는 유지합니다.
- 사용자 데이터는 소유권 검사와 RLS로 분리합니다. 서버 전용 키를 브라우저에 노출하지 않습니다.
- 개인자료·토큰·실제 계정 정보는 로그, fixture, 스크린샷에 포함하지 마세요.
- Worker 배포 도구는 IAM 대상 이메일을 `-IamMemberEmail` 또는 `UPLOAD_WORKER_IAM_MEMBER_EMAIL`로 받습니다. 배포 작업은 로컬 실행 절차와 별개입니다.

## Documentation

- [서비스·개발 명세](docs/SPEC.md)
- [API 계약](docs/api/API_SPEC.md)
- [AI 출력 규칙](docs/ai/AI_OUTPUT_SPEC.md) · [실행 JSON Schema](AI_OUTPUT_SCHEMA.json)
- [SQL·Migration 안내](supabase/README.md)
- [테스트 안내](scripts/README.md)
- [AI 분석 구조](docs/architecture/AI_ANALYSIS.md)
- [Upload 설정](docs/setup/UPLOAD_RUNTIME_SETUP.md)
- [개발 지침](AGENTS.md)

## License

이 저장소의 사용·재배포 라이선스는 아직 지정되지 않았습니다. 포함된 Pretendard 폰트는 [SIL Open Font License 1.1](public/fonts/Pretendard-LICENSE.txt)을 따릅니다.
