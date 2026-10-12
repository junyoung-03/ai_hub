# Promotional Production rollout gate review

RESULT: BLOCKED

Review date: 2026-10-12. Existing HEAD remains bfe7f5f. No staging, commit, push, production migration, or deployment performed in this review.

## Deployment order gate

- Vercel project ai-hub is linked to GitHub junyoung-03/ai_hub, production branch main.
- Current production target is READY at bfe7f5f049428119f27281f6a3f6485f45d4e567; deployment metadata records githubDeployment=1.
- New application before migration: NOT COMPATIBLE. src/lib/items/queries.ts unconditionally filters default Library/Home requests on the new item_is_visible computed field. A database without that function cannot execute the request. Noise override also requires new RPCs, and v0.3 persistence requires the new analysis wrappers. Fail-open for missing assessment rows does not handle missing database objects.
- The user's rollout instruction explicitly requires stopping before push when Git auto-deployment is connected and new code requires an unapplied migration. No deployment-setting changes or production migration were used to bypass that gate.

## Old application after migration

- Local migration rehearsal and legacy v0.2 persistence tests pass. Existing public persistence RPC names, argument lists, and return types are retained; no new mandatory argument is introduced. Exact existing persistence bodies are cloned into private v0.2 helpers.
- Unassessed ITEMs remain visible, v0.2 stored outputs remain readable, and no historical ITEM backfill is performed.
- The migration does not rewrite existing search sessions during DDL. Subsequent ITEM/Action/Source updates invalidate owner snapshots. The baseline application's search adapter maps P0002 to NOT_FOUND/404, while new code maps page expiration to CURSOR_EXPIRED/410. Baseline cursor recovery under the new invalidation behavior needs explicit compatibility verification.
- Rollback after v0.3 writes is a separate risk: bfe7f5f storedAnalysis only accepts artifact.schemaVersion=0.2. It omits v0.3 Event observations. Migration-first compatibility must not be confused with compatibility after new application writes.
- Remote read-only RPC/ACL/guard audit was attempted through Supabase MCP but returned Unauthorized (missing valid MCP access token). No remote SQL executed successfully in this review. Production backward compatibility is therefore NOT CERTIFIED; isolated PostgreSQL results do not replace the production contract audit.

## Validation rerun

- npm test: 227 PASS, 0 FAIL, 0 SKIP.
- npm run typecheck: PASS.
- npm run lint: PASS.
- npm run build: PASS.
- git diff --check: PASS.
- Staging area remains empty. Existing unrelated README edits were not modified or staged.

## Required next decision

Choose and authorize a deployment order that guarantees migration and old-app smoke precede production promotion, or implement a separately reviewed database-readiness gate for the new application. Also verify baseline cursor behavior and the v0.3 rollback boundary before claiming bidirectional compatibility. Restore read-only production DB access for the remote contract audit.

Production Gemini, toggles, overrides, protection smoke, external service regression, runtime logs, and CPU checks were not executed because rollout stopped at the pre-push gate. No production readiness claim is made.

Commit NO / Push NO / Force push NO / Production migration NO / Deploy NO / README unchanged by this task / Notion unchanged.
