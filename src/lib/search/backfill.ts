import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { indexItem, searchStore } from "./service";
import { semanticItemAllowed } from "./provider";
import { SearchError, uuid } from "./contract";
export type BackfillProgress = { startedAt: string; after: string | null; pending: string[]; failed: string[]; done: boolean };
/** Trusted server runner only, max five ITEMs/call, no unauthenticated or userId endpoint. */
export async function backfillCycle(progress: BackfillProgress, lexicalOnly = true) {
  const user = await requireUser(), store = searchStore();
  if (!Number.isFinite(Date.parse(progress.startedAt)) || (progress.after && !uuid(progress.after)) || progress.pending.length > 5 || progress.failed.length > 5
    || [...progress.pending, ...progress.failed].some(id => !uuid(id))) throw new SearchError("INVALID_BACKFILL_CURSOR");
  let ids = [...new Set([...progress.pending, ...progress.failed])].slice(0, 5), after = progress.after, exhausted = progress.done;
  if (!ids.length && !progress.done) {
    let query = store.admin.from("items").select("id").eq("user_id", user.id).lte("created_at", progress.startedAt).order("id").limit(5);
    if (after) query = query.gt("id", after);
    const { data, error } = await query; if (error) throw new SearchError("SEARCH_STORAGE_UNAVAILABLE", 503);
    ids = (data ?? []).map(i => i.id); after = ids.at(-1) ?? after; exhausted = ids.length < 5;
  }
  // Every semantic candidate must be approved on the server. No automatic personal full-corpus run.
  if (!lexicalOnly && ids.some(id => !semanticItemAllowed(id))) throw new SearchError("NON_SENSITIVE_APPROVAL_REQUIRED", 403);
  if (lexicalOnly && ids.some(semanticItemAllowed)) throw new SearchError("LEXICAL_MODE_REQUIRES_SEMANTIC_DISABLED", 409);
  const pending: string[] = [], failed: string[] = []; let completed = 0, skipped = 0, retryAfter = 0;
  for (const id of ids) {
    try { const result = await indexItem(id); if (result.state === "complete") completed++;
      else if (result.state === "skipped_limit") skipped++; else if (result.state === "failed") failed.push(id); else pending.push(id);
    } catch (error) {
      failed.push(id); if (error instanceof SearchError && error.status === 429) { retryAfter = error.retryAfter ?? 60; pending.push(...ids.slice(ids.indexOf(id) + 1)); break; }
    }
  }
  return { progress: { startedAt: progress.startedAt, after, pending, failed, done: exhausted && !pending.length && !failed.length },
    completed, skipped, pendingCount: pending.length, failedCount: failed.length, retryAfter };
}
