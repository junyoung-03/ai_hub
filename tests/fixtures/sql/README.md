# SQL 테스트 fixture

이 폴더는 테스트와 개발 검증 도구가 직접 읽는 SQL 보관본이다. 자동 적용 Migration이 아니며 SQL 본문을 정리 목적으로 수정하지 않는다.

| 폴더 | 용도 |
| --- | --- |
| `calendar/` | Calendar Scope·ITEM 저장의 계약 및 Migration 일치 검사 |
| `drive/` | Drive ITEM 저장의 검토 계약. 적용된 Migration과 내용이 다름 |
| `upload/` | Upload session·Storage 경계의 Migration 일치 검사 |

실제 변경 이력은 `supabase/migrations/`, 초기 SQL은 `supabase/baseline/`에 있다. fixture를 신규 Migration으로 복사하거나 원격 DB에 자동 적용하지 않는다.

격리 검사와 실연결 검사의 실행 조건은 [테스트 안내](../../../scripts/README.md)를 따른다.
