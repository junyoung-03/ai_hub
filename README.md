# AI 통합 정보 허브

Gmail·Google Drive·Google Calendar와 직접 추가한 자료를 한곳에서 검색하고, AI가 찾은 할 일·마감·일정을 원문 근거와 함께 확인하는 웹 서비스입니다.

메일에서 본 공지, Drive에 저장한 문서, 캡처해 둔 이미지가 흩어져 있으면 필요한 정보를 다시 찾거나 신청·제출 기한을 챙기기 어렵습니다. AI Hub는 입력 경로가 다른 자료를 하나의 **Unified ITEM**으로 관리하고, **수집(COLLECT) → 검색·분류(FIND) → 행동 관리(ACT)**로 연결합니다.

사용자는 자료를 연결하거나 추가한 뒤 검색창에서 필요한 정보를 찾고, 결과의 근거를 확인하며, 해야 할 일을 완료 처리할 수 있습니다.

## 주요 기능

- Gmail, Google Drive, Google Calendar 연결 및 수집
- PDF·이미지 업로드, 텍스트 추출·OCR, 직접 텍스트 입력
- Gemini 기반 분류·Action·Deadline·Event 분석과 사용자 분류 수정
- 자연어 통합검색, Keyword / Semantic / Hybrid Search
- 검색 결과의 Source·Evidence 확인과 자료 상세 보기
- 임박한 마감, 할 일 상태 관리, 월간 캘린더

지원 파일·수집 범위와 분석 제한은 [서비스 명세](docs/SPEC.md)를 따릅니다. Semantic Search는 환경 설정과 전송 허용 범위에 따라 동작합니다.

### 주요 화면

| 화면 | 역할 |
| --- | --- |
| Landing | 서비스 소개와 로그인 진입 |
| Home | 통합 검색, 임박한 마감, 이번 주 일정, 최근 추가 자료 |
| Library | 소스·분류·분석 상태로 자료를 탐색하고 파일·메모 추가 |
| Search | 검색 결과와 연결된 원문 근거 확인 |
| Actions | 할 일 상태 관리, 기한별 목록, 월간 캘린더 |
| Detail | 원문, AI 분류, 할 일·날짜·조건 및 근거 확인 |
| Settings | Google 연결·해제와 동기화 관리 |

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

## AI를 사용하는 방식

### 1. 자료를 텍스트로 준비

Gmail 본문, 지원하는 Drive 문서, 직접 입력한 텍스트를 공통 ITEM 구조로 다룹니다. 업로드한 PDF는 텍스트를 추출하고, 이미지나 스캔 자료는 OCR 처리 결과를 분석에 사용합니다. Google Calendar는 제공받은 일정 정보를 유지하며, 회의 날짜가 있다는 이유로 할 일을 생성하지 않습니다.

현재 공통 Gemini 분석 대상은 Gmail 이메일, Drive 문서, 직접 입력 텍스트, 추출이 완료된 업로드 PDF·이미지입니다. 입력 텍스트와 추출 상태 등 분석 가능 조건을 서버에서 확인합니다.

### 2. Gemini로 분류와 행동 후보 추출

Gemini에는 자료의 텍스트와 기존 분류 주제 후보를 전달하고, [JSON Schema](AI_OUTPUT_SCHEMA.json)에 맞춘 구조화된 결과를 요청합니다. 분석 모델은 `GEMINI_MODEL` 환경변수로 지정합니다.

| 분석 결과 | 의미 | 예시 |
| --- | --- | --- |
| `classification.primaryTopic` | 자료의 대표 주제 | 등록금, 프로젝트 제안서 |
| `classification.documentType` | 정해진 유형 중 하나 | 공지, 신청서, 계약서, 청구, 예약 등 |
| `classification.tags` | 탐색을 돕는 태그 | 학교, 납부, 신청 |
| `actions` | 사용자가 해야 하거나 선택할 행동 | 신청하기, 서류 제출하기 |
| `deadlineObservation` | 행동의 마감일 후보와 근거 | 제출 마감 문장과 날짜 |
| `eventObservations` | 행동과 독립된 행사·회의 날짜 | 세미나 개최일 |
| `requirements` / `conditions` | 제출 요구사항·적용 조건 | 참가신청서 1부, 신청 자격 |

문서 유형은 `notice`, `application`, `contract`, `billing`, `reservation`, `certificate`, `schedule`, `general`, `other`로 제한합니다. 기존 주제와 의미가 같으면 재사용하도록 요청하고, AI 분류와 사용자 수정 분류를 별도 필드에 저장합니다. 화면에 적용할 때는 사용자 수정값이 우선합니다.

### 3. AI 결과를 검증한 뒤 저장

AI 출력은 저장할 데이터의 **후보**입니다. 서버가 다음을 확인한 뒤 DB 트랜잭션으로 반영합니다.

- Ajv로 JSON Schema, 필수 필드와 허용값 검증
- 행동·날짜·요구사항의 근거 문장이 원문에 실제로 존재하는지 검증
- 원문 근거의 문자 위치를 계산해 Source와 Evidence 연결
- 날짜뿐인 안내와 실제 신청·제출 의무를 구분
- 연도 등 날짜 근거가 부족하면 확정하지 않고 `needs_review`로 처리
- 기존 Action 재사용·Source 병합 규칙을 적용하고 사용자 분류 수정값과 완료 상태 보호

예를 들어 “행사는 2026년 11월 5일, 신청 마감은 2026년 10월 31일”이라면 행사일과 신청 마감을 별도로 다룹니다. 날짜 충돌을 AI가 임의로 해결하거나 없는 제출 조건을 만들어 내지 않도록 제한합니다.

같은 텍스트·모델·Schema 버전으로 이미 분석한 결과는 fingerprint를 비교해 재사용합니다. 자세한 계약은 [AI 출력 명세](docs/ai/AI_OUTPUT_SPEC.md), 검증 구현은 [validation.ts](src/lib/gemini/validation.ts)에 있습니다.

## 중요도와 표시 순서를 정하는 방식

현재 홈의 “놓치면 안 되는 마감”은 별도의 AI 중요도 점수로 선정하지 않습니다. AI가 찾고 서버가 검증한 **확정 마감일**, **완료 여부**, **현재 날짜·시간**으로 우선 표시할 항목을 결정합니다.

| 기준 | 현재 동작 |
| --- | --- |
| 임박한 마감 | 완료되지 않았고 기한이 지나지 않은 확정 마감을 가까운 순으로 최대 4개 표시 |
| 임박 상태 | 미완료 항목 중 기한이 지나지 않았고 마감까지 3일 이내이면 `임박` 표시 |
| 기한 지남 | 시간이 있는 마감은 현재 시각, 날짜만 있는 마감은 오늘 날짜와 비교 |
| 날짜 불명확 | 확정 D-day 대신 `날짜 확인` 또는 `날짜 미정` 표시 |
| 할 일 목록 | 기한 지남 / 이번 주 / 다음 주 / 이후 / 날짜 확인 그룹으로 구분 |
| 이번 주 일정 | 오늘 이후까지 이어지는 이번 주 일정을 날짜순으로 최대 3개 표시 |
| 최근 자료 | 추가된 시점을 기준으로 최대 3개 표시 |

D-day와 주간 구분은 한국 시간(`Asia/Seoul`)을 기준으로 계산합니다. Calendar 일정과 AI가 문서에서 찾은 행사일은 별도 일정으로 표시하고, Action의 제출·신청 마감과 구분합니다. 최근 자료도 AI가 중요하다고 평가한 자료 목록이 아니라 최신 추가 자료입니다.

관련 구현: [일정 계산](src/components/actions/schedule-model.ts) · [홈·일정 표시](src/components/actions/schedule-workspace.tsx).

## 검색 기술

검색은 자료와 근거를 찾는 흐름으로 구성합니다. 현재 검색 API는 Gemini로 자유로운 답변을 생성하기보다 저장된 자료·Action과 원문 발췌를 반환합니다.

1. **Keyword Search**: 제목·본문 등에서 키워드 일치를 찾고 소스·형식·날짜 조건을 적용합니다.
2. **Semantic Search**: 텍스트를 청크로 나누고 `gemini-embedding-2`의 768차원 벡터로 변환하여 pgvector에서 의미 유사도를 비교합니다.
3. **Hybrid Search**: 키워드 순위와 의미 검색 순위를 RRF(Reciprocal Rank Fusion)로 결합합니다. 검색 관련도는 홈의 마감 우선순위와 별도입니다.
4. **Action 검색**: “이번 주 마감” 등 지원하는 한국어 패턴은 규칙으로 해석해 저장된 할 일을 날짜 조건으로 조회합니다. 모든 자연어 표현을 동일하게 해석하는 것은 아니며, 해석하지 못한 표현에는 문서 검색과 안내를 사용합니다.
5. **근거 반환**: 검색 결과에 자료 상세 링크, 원문 링크, 일치한 발췌와 위치 정보를 제공합니다.

Semantic Search는 서버 설정과 비민감 자료 ID 허용 목록에 한해 활성화됩니다. 전체 개인 자료가 자동으로 임베딩 대상이 되는 구조는 아닙니다. 구현은 [검색 서비스](src/lib/search/service.ts)와 [Embedding 제공자](src/lib/search/provider.ts)를 참고하세요.

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
ai_hub/
├── src/
│   ├── app/               페이지 라우트와 api/v1 API, Auth callback
│   ├── components/        Home·Library·Search·Actions 등 화면 컴포넌트
│   ├── lib/               수집·분석·검색·인증·업로드 서비스 로직
│   ├── types/             DB·API·AI 분석 결과의 TypeScript 타입
│   └── proxy.ts           요청 단계의 인증 세션 처리
├── public/
│   └── fonts/             폰트와 라이선스
├── supabase/
│   ├── baseline/          초기 SQL 보관본
│   ├── migrations/        이후 DB 변경 이력
│   └── README.md          SQL 적용 범위와 주의사항
├── workers/
│   └── upload/            Cloud Run 업로드 파서와 OCR 처리
├── scripts/               격리 테스트·실연결 검증·운영 도구
├── tests/
│   └── fixtures/          테스트용 합성 파일과 SQL fixture
├── docs/
│   ├── SPEC.md            서비스·개발 기준
│   ├── api/               API 계약
│   ├── ai/                AI Structured Output 규칙
│   ├── architecture/      AI 분석과 근거 연결 설계
│   └── setup/             Upload·검색·E2E 실행 안내
├── AI_OUTPUT_SCHEMA.json  런타임 AI 출력 검증 Schema
├── AGENTS.md              에이전트 개발 지침
├── .env.example           환경변수 템플릿
├── package.json           의존성과 실행·테스트 명령
└── README.md              프로젝트 소개와 실행 안내
```

### 핵심 코드 위치

| 경로 | 책임 |
| --- | --- |
| `src/app/api/v1/` | 요청 검증과 서비스 함수 호출을 담당하는 API 진입점 |
| `src/lib/google/` | Google OAuth, 토큰 암호화, Gmail·Drive·Calendar 수집 |
| `src/lib/gemini/` | Gemini 호출, 출력 Schema·원문 근거 검증 |
| `src/lib/items/` | Unified ITEM 조회·수정, 직접 입력, 분석 결과 저장 |
| `src/lib/search/` | 검색 의도 해석, 청크 생성, Embedding, 색인·검색 처리 |
| `src/lib/uploads/` | 업로드 세션, 추출·OCR 처리 연계, 원본 접근 |
| `src/lib/supabase/` | 브라우저·서버 DB 클라이언트와 인증 처리 |
| `src/components/actions/` | 할 일 상태 표시, D-day 계산, 목록·캘린더 표현 |

`tests/fixtures/`의 합성 자료는 검증용 파일이며 서비스에 표시되는 사용자 데이터와 별개입니다. `.env.local`, `.next/`, `.vercel/`, `node_modules/`, 생성된 `public/ocr/` 등 로컬 설정·빌드 산출물은 Git에서 제외합니다.

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
