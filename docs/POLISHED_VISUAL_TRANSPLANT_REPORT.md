# POLISHED VISUAL TRANSPLANT — 검증 보고

검증일: 2026-10-06 (Asia/Seoul)

**RESULT: PARTIAL**

실제 polished visual layer 이식과 로컬 build/브라우저 검증은 완료했다. 새 OCR 이미지의 AI 분석은 HTTP 503으로 실패했고, 외부 Gmail/Drive/Calendar 재수집은 이번 실행에서 수행하지 않았다. 따라서 전체 live Integration COMPLETE/MVP_READY를 선언하지 않는다. 시각 이식 범위에서 재현된 P0 UI 결함은 0개다.

## 1. Stale preview 해결

- 이전 3000 프로세스와 3001 dev 서버 종료. 기존 `.next` root build와 `.next/dev`가 다른 소스를 보여주던 상태 해소.
- 기존 빌드를 Windows 임시 디렉터리의 `ai-hub-visual-before-next-20261006`에 보관했다.
- 기능 변경 전 현재 소스로 baseline build PASS. 이후 3000만 사용했다.
- 최종 build PASS 후 `next start --hostname 127.0.0.1 --port 3000`으로 로컬 검증.
- 최종 브라우저 stylesheet: `/_next/static/chunks/0wnwy4jkh1f_f.css`. 실제 Primary `#1c1b19`, canvas `rgb(246,245,242)` 확인. Production 배포는 하지 않았다.

## 2. 실제 적용한 polished 파일/패턴

ZIP `UI_test_polished (1).zip`을 ZipFile/StreamReader로 실제 읽었다. 전체 frontend 구조와 핵심 구현을 조사한 앞선 mapping을 기준으로 이식했다. ZIP 전체 복사/덮어쓰기 없음.

| Polished ZIP | Current Repo | 실제 가져온 표현 |
|---|---|---|
| `src/app/globals.css` | `src/app/globals.css` | canvas/ink/surface/line, 상태색, 기본 서체·radius |
| `src/app/layout.tsx` | `src/app/layout.tsx`, `public/fonts/` | Pretendard 실제 로드; same-origin으로 보강 |
| `src/components/shell/AppShell.tsx` | `src/components/shell/app-shell.tsx` | TopBar→Sidebar/main, 본문 max 1024px, px16/32 |
| `src/components/shell/TopBar.tsx` | `src/components/shell/top-bar.tsx` | H/HUB brand, centered search, outline upload |
| `src/components/shell/Sidebar.tsx` | `src/components/shell/navigation.tsx`, `app-shell.tsx` | 208px white Sidebar, 36px active menu |
| `src/components/cards/ActionCard.tsx` | `src/components/search/search-results.tsx` | D-Day rail, title/date/source/evidence/preview/action |
| `src/components/cards/ItemCard.tsx` | `src/components/items/item-summary.tsx` | divided row/compact recent tile, title/metadata |
| `src/components/ui/Badge.tsx` | `item-summary.tsx`, `search-results.tsx` | text-first D-Day/status, 필요한 실패 상태만 surface |
| `src/components/home/HomeView.tsx` | `src/app/page.tsx`, `items/home-actions.tsx` | date/24px headline, 검색→마감→확인→최근 자료 |
| `src/components/search/SearchView.tsx` | `search/search-workspace.tsx`, `search-results.tsx` | shadow 없는 단일 결과 surface/rows/excerpt |
| `src/components/library/LibraryView.tsx` | `src/app/library/page.tsx`, `items/item-summary.tsx` | one surface/dividers/compact metadata |
| `src/components/actions/ActionsView.tsx` | `src/app/actions/page.tsx`, `search-workspace.tsx` | compact black active filters/Action presentation |
| `src/components/detail/DetailView.tsx` | `src/app/items/[itemId]/page.tsx`, `items/detail-layout.tsx` | paper original, structured insight, hierarchy |
| `src/components/shell/AddDialog.tsx` | `src/components/uploads/upload-controls.tsx` | dashed warm drop-area presentation |
| `src/components/settings/SettingsView.tsx` | `connections/google-connection-panel.tsx` | max672px, white divided service rows |

PrototypeContext/mock/findAnswer/static mock ITEM/fake connections/unread/cluster counts/precomputed D-Day/done 상태를 이식하지 않았다. ZIP의 mobile top menu는 제외하고 하단 Navigation을 유지했다.

## 3. Tokens / Font

| 용도 | 적용값 |
|---|---|
| Canvas/background | `#f6f5f2` |
| Surface/card | `#ffffff` |
| Ink/Primary | `#1c1b19` |
| Muted text | `#6f6b64` |
| Faint | `#9c978f` |
| Line/border | `#e6e3dc` |
| Brand soft/accent | `#f1efe9` |
| Rose / soft | `#9c3d34` / `#f7f1ef` |
| Amber / soft | `#7a6240` / `#f6f2ea` |
| Green / soft | `#3f624c` / `#f0f4f1` |
| rounded-lg / xl / 2xl | **8 / 12 / 16px** |

Body 16px, letter spacing -0.011em. Main content 14–16px, headline 20–24px, metadata 12px, weights 400/500/600. 기존 10/14/18px radius 매핑을 교체했다. 기본 카드 shadow 제거.

ZIP의 외부 CSS를 연결한 첫 검사에서는 font face가 실제 등록되지 않았다. 공식 Pretendard 1.3.9 Variable WOFF2와 SIL OFL license를 `public/fonts/`에 저장하고 `@font-face`/preload로 제공했다. 최종 production 브라우저에서 font face 1개, `document.fonts.status=loaded` 확인. 패키지 추가 없음. 폰트 약 2.06MB.

## 4. AppShell / TopBar

H mark 32px/12px radius, HUB, Desktop subtitle, 가운데 max576px 검색, 높이36px input, outline upload. 내부 높이56px + 하단 border1px. Sticky white header, 기본 shadow 없음. Auth의 서버 boundary와 실제 logout handler 유지.

## 5. Sidebar

208px, white, 오른쪽 1px line, top56px sticky. 메뉴36px/font14/active canvas/weight500. 가짜 unread/connection count 제외. 하단은 실제 Settings 진입 링크. 모바일은 기존 5개 bottom nav 유지.

## 6. Home

날짜→24px headline→자연어 검색→가까운 확정 마감→확인 필요→최근 자료. 큰 검색 Card를 없애고 border-bottom 입력으로 통합. 실제 owner Action 페이지를 모두 조회해 확정 마감 기준으로 정렬하며, 근거·완료 API를 유지. Source chips에는 가짜 개수를 넣지 않았다. 최근 자료는 실제 ITEM 6건의 compact tile.

## 7. Search

큰 white/purple Search Card 제거. 큰 입력은 canvas에 통합하고 결과만 white surface/divided rows. 형식 표시→title→Source/date→matched excerpt→Evidence/location→Detail. Excerpt는 2줄로 줄이고 원문 이동 제공. Fetch/debounce/abort/cursor/Retry-After/filter/semantic/degraded 계약 유지. mock answer/chat 없음.

## 8. Library

목록을 단일 surface/divided row로 교체. 형식 표시, 16px/500 제목, compact metadata와 실제 분류. 현재 source/date/additional filters와 cursor 유지. unread/cluster/topic 개수 없음. 미리보기는 형식 표시이며 원문 내용/페이지 수를 꾸며내지 않는다.

## 9. Actions

실제 polished ActionCard full 구조 사용. Desktop112px/Mobile96px rail, 본문 title/date/source/requirements/conditions/evidence, 기존 실제 완료/복원 버튼. urgency/review만 subtle status surface. 상태는 API `completed`, D-Day는 기존 KST 계산. 필터는 검정 active pill/차분한 inactive text.

## 10. Detail

65:35 유지. 실측 Original651.72px/Insight352.28px, gap20px. Original은 white paper, 16px/32px 읽기 본문. Insight는 white border12px radius/p20 structured panel. Action→마감→요구사항/조건→Evidence→일정 관찰→분류→Similar. 큰 마감 배경 Card 제거. Google 원본, Upload 원본, Calendar 날짜, current/historical Evidence/location 모두 유지.

## 11. Upload

기존 Library disclosure를 유지하고 dashed warm drop area/compact buttons로 이식했다. 새 modal은 추가하지 않았다. signed upload/PDF/Tesseract/checkpoint/localStorage/resume/cancel/별도 bounded AI 분석 handler 유지.

실제 검증:
- 기존 합성 JPG 재업로드: 중복 재사용/저장 정상. 자동 AI 분석 실패 상태 표시.
- 새 `synthetic-polished-ocr.png`: 실제 client Tesseract7/kor+eng/OCR 실행, canonical 한글/영문/숫자 저장, Detail 표시 PASS.
- OCR은 `UI`의 I를 l로 인식했다. 이 문자 오차를 숨기거나 본문을 수정하지 않았다.
- 새 이미지의 분석 endpoint는 **HTTP503(약117초)**. 원문·추출 결과가 유지되고 Detail 재시도 안내가 표시됐다. 성공으로 판정하지 않았다.
- 새 합성 이미지 ITEM 1건을 검증 자료로 유지했다. 기존 데이터 삭제/cleanup 없음.

## 12. Settings

Max672px account block + divided Gmail/Drive/Calendar 서비스 rows. 실제 연결·capability 상태, 원래 connect/disconnect/sync/collect handler 유지. Drive target form은 disclosure에 넣었다. 계정 통합 연결 해제를 가짜 서비스별 해제로 바꾸지 않았다.

## 13. Mobile

390×844 실측. Home/Search/Detail 모두 horizontal overflow 없음. bottom nav bottom=844/5개 메뉴/active 정상. Detail 원문/AI 탭 정상, TopBar 아래 sticky, 원문과 insight가 번갈아 표시. Upload와 Settings도 mobile overflow 없음. 고정 nav를 피하도록 본문 하단 padding 유지.

## 14. Backend logic 재사용

다음 경로 tracked diff 없음: `src/lib`, `src/types`, `src/app/api`, `src/proxy.ts`, `supabase/migrations`, `workers`, package/lockfile.

TypeScript AST로 HEAD 대비 function body 동일 확인:
- Google `collect/sync/connect/disconnect`
- Upload `start`
- Classification `save`, Action `change`
- Detail `analyze/open`

Search run/fetch/debounce/cursor 코드도 diff상 변경 없음. UI 내부 form/state는 실제 API 제어와 표시용 상태만 사용한다. DB/schema/RLS/Storage 정책 및 Notion 변경 없음.

## 15. Browser Visual QA

최종 production build로 Desktop1440×900의 Home/Search/Library/Actions/Detail/Settings 및 Mobile390×844 Home/Search/Detail을 다시 확인했다. 모두 overflow 없음.

증빙은 `docs/final-ui-verification/`:
- `after-home-desktop.jpg`, `after-home-mobile.jpg`
- `after-search-desktop.jpg`, `after-search-mobile.jpg`
- `after-library-desktop.jpg`, `after-actions-desktop.jpg`
- `after-detail-desktop.jpg`
- `after-detail-mobile-original.jpg`, `after-detail-mobile-insight.jpg`

Settings의 실제 계정 이메일은 최종 보고 이미지에 포함하지 않았다. Screenshot은 합성 자료 위주다.

## 16. Before / After

실제 이식 전 mobile 증빙 `before-detail-mobile.jpg`(앞선 단계의 `detail-mobile.jpg` 사본)와 after를 비교한다. 이 before는 이미 olive 색으로 바뀐 수정본이며, stale3000의 purple 버전이라고 표시하지 않는다.

- Header: Hub/+자료 추가/검색 아이콘 → H/HUB/global search/outline 올리기
- Navigation: 큰 active block → 36px warm selection/14px label
- Search: padding28의 큰 Card → canvas input/divided result surface
- Action: 제목/배경 D-Day pill → 왼쪽 D-Day rail/날짜·출처·근거·버튼
- Detail: 큰 제목/배경 마감 Card/insight canvas → paper + compact white insight
- Typography: 폰트 문자열만 지정 → 실제 same-origin Pretendard 로드

단순 색상 변경만 수행한 것이 아니다. 초기 Desktop before 캡처는 loading 화면이어서 비교 증빙에서 제외했다.

## 17. Regression

| 기능 | 이번 검증 |
|---|---|
| Login/Auth | 실제 logout→login→Google OAuth→Home 성공. 서버 guard 유지. isolated auth tests PASS |
| Search | 실제 Search→Detail PASS, cursor20→40 PASS, Source/Format 필터 PASS; image 필터 최종3건 |
| Semantic/degraded | 비민감 `synthetic` query로 실제 fallback 안내/keyword6건 유지 PASS |
| Retry-After/오류/cursor security | isolated Search/fault tests PASS; 실제 rate-limit 유발하지 않음 |
| Classification | 실제 PATCH 저장→Detail 반영→원래 주제 복구 PASS |
| Action | 실제 completed→open 복원/Detail 재조회 PASS |
| AI Detail | 기존 합성 PDF의 실제 Gemini 저장 결과/action1/current+historical evidence/deadline2026-10-15/event2026-10-20 표시 PASS |
| OriginalAccess | 실제 signed original 준비→원본 열기 link 표시 PASS |
| Similar Items | 실제 endpoint의 `not_indexed` 상태 표시 PASS. 가짜 유사 자료 없음 |
| Upload/OCR | 새 이미지의 실제 client OCR/저장/Detail PASS; provider 분석503 별도 기록 |
| Gmail/Drive/Calendar | 기존 수집/OAuth 격리 tests PASS, handler 동일, 실제 저장 자료의 production query 조회 PASS |
| RLS/owner | 기존 isolated owner/foreign/anonymous boundary tests PASS; 정책 수정 없음 |

**이번에 외부 Gmail/Drive/Calendar 수집 버튼을 다시 실행하지 않았다.** 기존 개인 자료의 신규 Gemini 분석이나 개인 semantic backfill은 수행하지 않았다. 격리 테스트/읽기 검증을 새로운 외부 수집 E2E 성공으로 표시하지 않는다.

## 18. Tests / Build

- `npm test`: **161/161 PASS**
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS, 최종 build로 브라우저 재검증
- `npm run check:supabase`: PASS (Auth settings reachability; live RLS 검사라는 뜻은 아님)
- `git diff --check`: PASS
- 별도 read-only production query verifier: Gmail/Drive/Calendar 저장 자료 조회 PASS
- handler AST 동일 검사 PASS; 새 OCR canonical 저장 확인 PASS

## 19. 남은 GAP

- 핵심 visual transplant에 재현된 P0 결함 없음.
- 실제 원본 thumbnail 데이터가 없는 목록은 형식 표시 사용. 가짜 paper/page/이미지 미리보기 제외.
- Upload는 polished drop-area를 사용하고 기존 disclosure를 유지. 완전한 Modal 동선은 이식하지 않았다.
- 실제 source/status/filter/cursor 계약에 맞춰 mock count/cluster/read 상태/answer는 제외.
- 새 OCR 이미지의 AI HTTP503 해결/성공 검증은 미완료. Backend redesign이나 반복 무제한 provider 요청으로 우회하지 않았다.
- 외부 Google 재수집 E2E는 미실행. 별도 explicit 비민감 test 대상/승인된 데이터 범위로 후속 검증해야 한다.
- Similar는 현재 대상 미색인 상태. 개인 자료 embedding backfill 없음.

## 20. Preview 가능 여부

소스/테스트/build 기준 **Preview 배포 가능한 상태**이며 현재 최종 산출물은 `http://localhost:3000/`에서 확인할 수 있다. 외부 provider 가용성까지 포함한 전체 MVP_READY 또는 live Integration COMPLETE는 선언하지 않는다.

Production/Preview 외부 배포, DB migration, Notion 수정은 실행하지 않았다.
