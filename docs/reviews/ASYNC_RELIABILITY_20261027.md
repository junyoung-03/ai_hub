# Async processing reliability

The asynchronous processing architecture and existing provider limits remain in place. This change makes unfinished items visible, projects actionable processing states, repairs explicit search-index retries, and reconciles interrupted Gmail worker leases.

## Behavior

- The Library defaults to every processing state. Source/date/promotional filters and pagination continue to use the existing query contract.
- The owner-scoped status endpoint returns only item IDs and safe status projections. It never initiates collection, analysis, or indexing. Polling is serialized, pauses when hidden, times out each request after ten seconds, and stops after five minutes or terminal state. Shrinking the active item set does not restart that deadline.
- Empty text and unsupported sources are not presented as runnable AI work. Safe errors distinguish provider limits, validation failures, unavailable configuration, and paused schedules.
- Search continuation preserves cached analysis and chunk progress. Only an explicit failed retry resets attempts. `retry_search_index` holds the existing item/job locks while checking provider cooldown and resetting attempts. A live lease remains busy.
- Index completion must match the source revision. Independent keyword indexing of unanalysed or Calendar items remains supported without changing their AI status.
- Collection and analysis results are displayed separately. Partial/failed collection does not fabricate a successful current timestamp. Existing stored success checkpoints remain identifiable as past success records.
- Gmail admission and the free worker share server configuration. Database admission additionally checks the actual Vault scope, active demo schedule, and remaining daily budget. Admission and automatic schedule shutdown share the existing budget-row lock.
- Each claimed free Gmail job gets a DB-only `etc-gmail-lease-<item-id>` cleanup schedule. Once the lease expires or the job finishes, it reconciles the job and removes itself. It makes no HTTP/provider calls and consumes no analysis reservations. Only the matching item snapshot/revision is marked interrupted; newer source content is preserved.

## Validation

- `npm run test:isolated`: 366 tests passed, including API/UI handlers, fake-clock polling, SQL isolation/permissions, fifth-reservation crash recovery, stale worker fencing, search retry cooldown, and owner isolation.
- `npm run typecheck` and `npm run lint`: passed.
- `npm run build:analysis-worker`, `npm run prepare:upload-assets`, and `npm run build`: passed. The web build used synthetic Supabase values; it is not production authentication or provider validation.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund`: passed after restoring the two missing optional emnapi lock entries. No dependency version was upgraded.
- Test SQL loads normalize checkout line endings in memory so PostgreSQL function-body checks run identically on Windows and Linux. Existing applied migration files are unchanged.

## Release order

1. Confirm the target Supabase project and its recorded migration history. Preserve the existing free-demo environment/Vault scope, billing settings, and 15-minute processing schedule policy.
2. Apply `20261027090000_gmail_analysis_admission_and_lease_cleanup.sql` and then `20261027090100_atomic_search_index_retry.sql` through the project's migration process. The first migration registers cleanup only for already-running jobs inside the existing approved demo scope; it does not enqueue historical items or restart the processing schedule.
3. Deploy the application revision after both migrations succeed. Missing RPCs fail closed for worker admission/retry; optional status reads keep manual refresh available.
4. In the authenticated app, verify Library filter removal, empty-text messaging, error detail, status refresh, and an explicit index continuation. Confirm source text, user edits, Actions, and Evidence remain unchanged.
5. Recover existing work by stage: resume indexing without reanalysis; inspect analysis failures and retry only eligible, explicitly scoped work within the remaining quota. A stopped Gmail demo schedule needs an operator to set/restart its bounded scope. Do not expand the allowlist, raise daily limits, or backfill the mailbox as part of recovery.

Production migrations, deployment, and existing-data recovery are not established by the local checks above. Record their verified outcome separately when performed.

## Rollback

The previous application revision remains compatible with the additive database functions. Prefer reverting the application first; retain lease cleanup until no job is running. Do not unschedule cleanup while abandoning an active worker lease. These migrations do not delete source data or modify classifications/Actions/Evidence. Do not reset private job tables or retry counters globally.
