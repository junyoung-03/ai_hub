# Promotional database-readiness gate verification

RESULT: PROMOTIONAL_ROLLOUT_GATE_READY

Scope: local implementation and isolated regression only. No production DB migration, commit, push, deployment, README edit, or Notion edit in this task. Existing HEAD remains bfe7f5f. This is not a claim that live Gemini or production end-to-end rollout has been verified.

## Compatibility matrix

- OLD DB + OFF: PASS. No readiness, assessment, computed visibility, or override calls. Legacy Library/Home/Search and Gemini v0.2.
- OLD DB + ON: PASS. Missing readiness RPC disables feature. Legacy queries, v0.2 analysis, no automatic hiding.
- NEW DB + OFF: PASS. Same legacy paths, including force_promotional ITEMs being returned by the preserved legacy Search RPC. Newly created noise objects are unused.
- NEW DB + ON: PASS. Capability and REST schema-cache probes enable promotional queries and v0.3 analysis. Existing A-H visibility, RLS, protection and override regressions pass.

The matrix combines mocked PostgREST/provider boundaries with real application modules and isolated PostgreSQL migration rehearsal. Production DB was not contacted or modified in this task.

## Gate and fallbacks

- src/lib/items/promotional-gate.ts: exact server flag PROMOTIONAL_NOISE_ENABLED=true is required; missing/false/invalid values disable the feature before client creation. No NEXT_PUBLIC flag or client-supplied enablement.
- ON readiness: read-only promotional_noise_ready RPC checks required table columns, visibility/override/persistence/search functions and wrapper routing. Zero-row assessment and computed-field requests verify the REST schema cache. Probes share a 2-second timeout; errors fail open. No positive process cache.
- Library/Home: OFF uses the original query without item_is_visible. A missing-contract error after a successful probe retries once without the visibility filter. Auth, owner filtering, sort and limit remain enforced.
- Search: original search_candidates and search_similar bodies are preserved. Only ON+READY calls separate *_promotional RPCs. Missing promotional RPC/schema during a request falls back once to preserved candidates with the existing query vector. Ranking and document indexing remain unchanged.
- Override: OFF/not-ready returns a safe 404 before creating an override client or calling an override RPC. Server UI hides Library/Home/Search toggles and Detail noise controls.
- Readiness adds DB round trips only while flag=true; no extra Gemini or document Embedding generation. Local tests do not establish production latency for the probes.

## AI and stored data

- OFF or not-ready selects the baseline v0.2 prompt/schema/fingerprint in the same analysis pipeline.
- ON+READY selects v0.3 with noiseAssessment. One existing Gemini analysis request per successful test case; no separate promotional analysis.
- Persistence rechecks the gate for v0.3. If disabled, it strips noiseAssessment, validates v0.2 and computes the v0.2 fingerprint. No second Gemini call is made.
- Existing v0.2/v0.3 readers are independent of the flag. OFF Detail regression confirms v0.3 Event (2026-10-24), existing Action and Classification remain available.
- First operational rollback is flag OFF on this compatible reader. bfe7f5f code rollback after v0.3 writes remains a separate unsupported boundary.

## Search cursor/snapshot

- OFF context matches the original signed legacy cursor context; the cursor is accepted by the new application.
- ON context is isolated with the noise policy version. Mode mismatch and expired/missing snapshots produce 410 for the existing safe first-page retry UI.
- New snapshots are marked promotionalEnabled=true only while enabled. Noise/protection triggers invalidate only marked snapshots. Legacy snapshots survive noise override changes and remain readable.
- Isolated SQL additionally removes the visibility function and assessment table, confirms readiness=false, and confirms legacy candidates still work. These destructive tests run only in a disposable synthetic PostgreSQL instance.

## Unapplied migration file

The existing unapplied 20261012110525_promotional_noise_contract.sql was revised to add the readiness RPC, separate promotional search RPCs and selective snapshot invalidation. No new migration was generated and no remote migration was applied. Local tests rehearse this file in disposable PostgreSQL only.

## Validation

- npm test: 241 PASS / 0 FAIL / 0 SKIP; baseline 227 preserved.
- npm run typecheck: PASS.
- npm run lint: PASS.
- npm run build: PASS.
- git diff --check: PASS.
- New test suite: scripts/test-promotional-gate.mjs, 14 tests covering the matrix, missing table/function/schema cache, network failure, no calls OFF, one-call schema selection, v0.3 reader OFF, legacy cursor and snapshot retention, and query-time fallback without retry loops.
- Staging remains empty. The pre-existing unrelated README diff remains 124 added lines, untouched.

DB CHANGE NO / Migration applied NO / Commit NO / Push NO / Deploy NO.
