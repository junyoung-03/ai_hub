# Gmail automation: release and recovery notes

The requested change preserves the existing asynchronous Gmail queue and adds a disabled-by-default scheduler path for one configured owner. The old three-ID demo path remains when automatic mode is disabled. New or changed eligible Gmail text is queued by the existing DB trigger. Automatic collection uses the existing inbox query (last 30 days, at most 100 messages per scan); a capped scan is recorded as partial and is not proof that every message was collected. An automatic worker processes one queued item per invocation, keeping the existing minimum 60-second interval and five project-wide reservations per UTC day. Excess work waits for the next budget day. Actual Gemini quota can be lower and resets on the provider's schedule. No paid plan or increased quota is configured here.

## Failure records

`private.analysis_diagnostic_history` records owner, item ID, source, state, attempt, timestamp and sanitized code. Rule-specific examples are `ANALYSIS_VALIDATION_REQUIREMENTS`, `ANALYSIS_VALIDATION_EVIDENCE`, and `ANALYSIS_VALIDATION_DATE_INFERENCE`; the owner sees the recent history in a failed item's detail. The original ten `ANALYSIS_VALIDATION_FAILED` records do not reveal their old validation rule. The new rule is known only after a new analysis attempt. `private.gmail_sync_history` separately records collection state, time, counts and safe codes such as `REFRESH_FAILED`, `GMAIL_RESULT_LIMIT`, and `SYNC_WORKER_INTERRUPTED`. No mail body, provider output, OAuth token, API key or worker lease token is stored in either history table. Normal application roles cannot access the private tables directly.

`private.gmail_dispatch_history` preserves scheduler request IDs, timestamps, timeout state and HTTP status without saving response bodies or headers. The next dispatcher invocation reconciles pg_net results before their normal expiry. A dispatch HTTP 200 only confirms the handler responded; consult the collection and analysis histories for the actual outcome. A database outage can also prevent history writes, so use platform logs for that interval.

In Supabase SQL Editor, an administrator can inspect the latest codes without opening content:

```sql
select occurred_at, source, state, attempt, error_code
from private.analysis_diagnostic_history
order by occurred_at desc, id desc limit 100;

select occurred_at, state, error_code, collected_count, created_count, updated_count, failed_count
from private.gmail_sync_history
order by occurred_at desc, id desc limit 100;

select occurred_at, kind, state, http_status, completed_at
from private.gmail_dispatch_history
order by occurred_at desc, id desc limit 100;
```

## Release order and verification

1. Save and verify the existing source, application data and Storage originals separately. A CSV snapshot is not a complete PostgreSQL, Auth, Vault or configuration backup. Store personal backups locally with restricted access.
2. Apply `20261028090000_analysis_diagnostic_history.sql` and `20261028090100_gmail_automatic_processing.sql` in order, recording migration history. Both are additive; automatic mode is initially disabled and creates no schedules.
3. Deploy the new application revision and verify the migration functions/permissions, configured owner and secret readiness without printing secret values. The configured owner must agree with the existing Vault scope and server environment.
4. Only after verifying both migrations and deployment, set the single configured owner and enable automatic mode. Schedule the sync dispatcher every 15 minutes and the analysis dispatcher every two minutes. Use `private.dispatch_gmail_automatic('sync')` and `private.dispatch_gmail_automatic('analysis')`; it generates a short-lived signed request with the existing secret. Never expose the signature secret in SQL output or logs.
5. Test a fresh, explicitly suitable non-sensitive Gmail end to end, including after closing the browser. Verify sync, queued, analysis, result or precise failure, and history. Do not mark a successful HTTP dispatch as successful analysis. Do not automatically requeue existing validation failures before their cause and quota are assessed.
6. Record exact deployed revision, schedule state, results, limits and unresolved errors in the local relay. Test the previous deployment rollback path before calling the demonstration ready.

## Rollback

Disable `private.gmail_automation_config.enabled`, unschedule `etc-gmail-auto-sync` and `etc-gmail-auto-analysis`, and wait for any in-flight sync to finish or its six-minute lease to expire. Revert or redeploy the prior application commit `4786a67d08d88fd172552b4381e77924e9276e02`. Do not delete queues, history, source records, or the lease cleanup jobs while an analysis lease is active. The new tables and functions may remain in place with automatic mode disabled. Do not overwrite live rows with the CSV snapshot without a separately reviewed transactional restore procedure.
