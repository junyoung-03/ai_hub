# Empty search navigation fix — LOCAL 2026-10-09

Scope: empty query navigation only. UI, Search API/ranking/Gemini/DB/OAuth/Upload unchanged.

## Cause and fix

The existing Server Component threw redirect('/') after awaiting searchParams. The installed React development profiler measured the errored component with a negative end timestamp. Browser reproduction: all nine direct empty-query visits reported `SearchPage cannot have a negative time stamp`. Moving request-time acquisition or placing the redirect in a synchronous server child did not remove the profiler error. No route sending Home back to /search was found; this was not a redirect loop.

SearchPage still owns query parsing: missing, empty, whitespace, and non-string query are considered empty; valid strings remain trimmed and limited to 500 chars. The empty branch now returns EmptySearchRedirect, a client component rendering null and calling router.replace('/') once with a ref guard for development StrictMode effect replay. It never mounts SearchWorkspace or invokes Search API. The server no longer throws redirect for this branch. There is no simultaneous server redirect/client effect redirect.

SearchWorkspace's old state-watching empty-query navigation effect was removed. Clearing an existing query uses one explicit input event transition to Home, preserving the previous behavior without an effect navigating on render.

Server-only redirect was preferred but reproduced the installed dev profiler defect. A routing proxy alternative was rejected by automatic approval review because it would return before session handling and conflict with the user's Auth protection. That alternative was not applied. Next routing redirect configuration also forwards the incoming empty q onto the Home URL; no routing config change remains.

## Changed application files

- src/app/search/page.tsx
- src/components/search/search-workspace.tsx
- src/components/search/empty-search-redirect.tsx (new)

Auth/session proxy, next.config.ts, Home, Landing, Library, Actions, Calendar, Upload/OCR, API/DB have no changes from this step. Existing uncommitted changes are preserved.

## Verification

Using a separate authenticated QA browser session with normal owner cookies; read-only actual Search API. No test items created and no business data writes.

- `/`: Home normal.
- `/search`, `/search?q=`, `/search?q=%20%20`: three rounds each, one Home navigation per visit, no Home document request / hard reload, no loop, console Performance errors 0.
- `/search?q=AI`: actual Search result normal.
- Home search `AI`: query-containing Search URL and actual results normal.
- Clearing Search input: Home transition with document requests 0.
- npm test: 174/174 PASS.
- npm run typecheck / lint / build / git diff --check: PASS.

Browser script/results and initial source copies remain under .git/local-ui-baseline/empty-search; no secret/session values stored. The OAuth callback and Upload/OCR were NOT TESTED IN THIS STEP.

Production deploy: NO
Commit: NO
Push: NO
Local URL: http://localhost:3001
