# SQL 기준 파일과 개발 DB Migration 이력

2026-10-04 기준. 대상은 개발 프로젝트 **ai-hub-dev**, project ref `oclzdppdiljbojvqtkeu`다. Production 적용 기준을 확정하는 문서가 아니다.

## 역할과 적용 순서

| 순서 | 현재 보관 파일 | 파일 기준 버전 | 개발 DB history version | history name | CLI local/remote |
| --- | --- | --- | --- | --- | --- |
| 1 | `../0001_initial_schema (4).sql` | v0.5 REVIEW | `20261003103041` | `initial_schema_v05` | remote only |
| 2 | `../0002_db_optimization.sql` | v0.1 | `20261003104321` | `db_optimization_v01` | remote only |
| 3 | `migrations/20261004045936_google_data_oauth_token_storage.sql` | Phase 4 수정본 | `20261004045936` | `google_data_oauth_token_storage` | local/remote 일치 |
| 4 | `migrations/20261004115419_persist_gmail_item_analysis.sql` | 승인된 Phase 6A RPC | `20261004115419` | `persist_gmail_item_analysis` | dev 적용 및 history 등록 |

Phase 6A 순서 4는 기존 테이블·Evidence trigger·AI 분류 RPC에 의존하며 테이블 구조는 변경하지 않는다.
승인 후 ai-hub-dev에 해당 SQL만 실행했고 해당 version만 applied history로 등록했다.
`SECURITY DEFINER`, 빈 search_path, service_role 전용 EXECUTE이며 실제 권한과 합성 transaction/rollback 검사를 수행했다.
이 단계에서 기존 SQL 및 다른 migration history는 변경하지 않았다.

초기 Schema → Optimization → Token Storage 순서로 의존한다. 순서 3은 기존 `public.connections` 등 초기 테이블에 의존한다. 루트 SQL 두 파일은 CLI가 자동 발견하는 `supabase/migrations` 파일이 아니다.

순서 3은 SQL Editor로 적용한 뒤 이전 Phase 4 작업에서 `migration repair --status applied`로 history를 등록했다. 2026-10-04 이번 정리에서는 `migration list --linked`와 `schema_migrations`의 version/name을 읽기 전용으로 재확인했으며 SQL 실행, repair, DB 변경을 하지 않았다.

## 보관본과 적용 이력의 관계

- 초기 파일의 `v0.5 REVIEW`와 Token Storage의 `DRAFT ONLY` 주석은 작성 당시 표시다. 이번 정리에서 기존 SQL 내용을 변경하지 않았으므로 현재 적용 여부는 위 history 기록으로 판단한다.
- 초기 Schema와 Optimization은 이력 SQL과 **문자열 리터럴을 보존한 SQL 토큰 비교에서 일치**했다. 비교에서는 주석, 공백, 최상위 BEGIN/COMMIT wrapper를 제외했으며 원격 SQL은 메모리에서만 다루고 출력·저장하지 않았다. 단순 공백 축약만으로는 초기 Schema의 연산자 주변 형식 차이가 남아 추가 토큰 비교를 수행했다.
- 원본 byte hash는 주석·줄바꿈·형식까지 포함하므로 서로 다르다. 토큰 비교는 현재 DB Schema의 일치나 Runtime 검증을 대신하지 않는다.
- Token Storage는 history version이 local/remote 양쪽에 존재함을 확인했다. history 등록은 원본 파일 전체의 byte 일치나 실제 Schema를 증명하는 검사가 아니며, 실제 Schema/RPC 권한/Runtime 검증은 Phase 4 기록을 따른다.

현재 Windows 작업 사본의 byte 기준 SHA-256이다. Git의 CRLF/LF 정규화나 다른 OS의 checkout에서는 byte hash가 달라질 수 있으며, 줄바꿈 차이를 SQL 변경으로 단정하지 않는다.

```text
0001_initial_schema (4).sql
C4F9F38EE8D8CEF7DE403F8BBBE2BCDB43B68898ADD52A2115EC809D91B6B555

0002_db_optimization.sql
365A0B876FE45D7B46B49A2916B384A4433B09ABE3931EB366C7F0656FB9A614

20261004045936_google_data_oauth_token_storage.sql
41D56D2AE77682C6E91494F26A827FEB0360B38475164F8D3F4AC82BD9DC6289
```

## 현재 재현 범위와 남은 항목

현재 `supabase/migrations`만으로 빈 DB를 처음부터 생성하는 전체 체인은 준비되지 않았다. 초기 두 version이 remote only인 상태는 알려진 제한이며 local/remote 전체 일치로 보고하지 않는다.

팀 합류 후 새 개발 DB가 필요하면 확인된 초기 적용 SQL과 보관본을 바탕으로 local baseline 구성 방법을 승인한 뒤 재현 체인을 준비한다. 검토 없이 기존 보관본을 timestamp 이름으로 복사하거나 새 version으로 재적용하지 않는다. 기존 ai-hub-dev를 맞추기 위해 history를 삭제하거나 SQL을 재실행하지 않는다.

## 읽기 전용 확인 명령

Supabase CLI가 인증되어 있고 올바른 개발 프로젝트에 linked되어 있는 환경에서 실행한다. DB 비밀번호나 Secret을 명령 문자열·문서에 넣지 않는다.

```bash
npx --yes supabase@latest migration list --linked
npx --yes supabase@latest db query --linked "select version,name from supabase_migrations.schema_migrations order by version"
```

SQL/RPC Runtime 검증과 Google/Gmail 실연결 테스트는 `../scripts/README.md`, 상세 제품·구현 기준은 루트 `SPEC.md`를 따른다.
