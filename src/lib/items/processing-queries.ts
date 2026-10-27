import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { analysisEligible } from "@/lib/items/analysis-policy";
import { isItemId, InvalidItemQueryError } from "@/lib/items/filters";
import { summarizeProcessing, type AnalysisJobStatus, type ProcessingSnapshot } from "@/lib/items/processing";
import type { Json } from "@/types/database";
import { freeAnalysisScope } from "@/lib/items/free-analysis-scope";

type StatusClient = { rpc: (name: string, args: { p_item_ids: string[] }) => PromiseLike<{ data: unknown; error: unknown }> };
/** Optional migration: unavailable job state must never invent active work. */
export async function readAnalysisJobs(client: object, itemIds: string[], userId?: string): Promise<Map<string, AnalysisJobStatus>> {
  const jobs = new Map<string, AnalysisJobStatus>();
  if (!itemIds.length) return jobs;
  let runnableIds: string[] = [];
  try { const scope = freeAnalysisScope(); if (userId && scope.users.includes(userId)) runnableIds = scope.items; } catch { /* Misconfigured or disabled workers cannot progress queued work. */ }
  try {
    const { data, error } = await (client as StatusClient).rpc("gmail_analysis_job_status", { p_item_ids: itemIds });
    if (error || !Array.isArray(data)) return jobs;
    for (const row of data) {
      if (!row || typeof row !== "object" || !itemIds.includes(row.itemId) || !["pending", "running", "retry", "complete", "failed"].includes(row.state)) continue;
      const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
      jobs.set(row.itemId, { itemId: row.itemId, state: row.state, leaseUntil: timestamp(row.leaseUntil), availableAt: timestamp(row.availableAt), schedulerAvailable: row.schedulerAvailable === true && runnableIds.includes(row.itemId) });
    }
  } catch { /* A deployment without the read RPC keeps manual refresh available. */ }
  return jobs;
}

export const processingColumns = "id,source,format,processing_status,processing_error,updated_at,content_text,upload_extraction:metadata->upload->extraction";
type ProcessingRow = { id: string; source: string; format: string; processing_status: ProcessingSnapshot["processing"]["status"]; processing_error: string | null; updated_at: string; content_text: string | null; metadata?: Json; upload_extraction?: Json };
export async function projectProcessing(client: object, rows: ProcessingRow[], userId?: string) {
  // Lists/status reads need only extraction readiness, not full stored AI artifacts.
  const inputs = rows.map(row => ({ ...row, metadata: row.metadata ?? { upload: { extraction: row.upload_extraction ?? null } } }));
  const jobs = await readAnalysisJobs(client, inputs.filter(row => row.source === "gmail" && ["queued", "analyzing", "failed"].includes(row.processing_status) && analysisEligible(row)).map(row => row.id), userId);
  return new Map(inputs.map(row => [row.id, summarizeProcessing(row, analysisEligible(row), jobs.get(row.id))]));
}

export function parseProcessingIds(params: URLSearchParams): string[] {
  if ([...params.keys()].some(key => key !== "ids") || params.getAll("ids").length !== 1) throw new InvalidItemQueryError();
  const ids = params.get("ids")!.split(",");
  if (!ids.length || ids.length > 100 || ids.some(id => !isItemId(id)) || new Set(ids).size !== ids.length) throw new InvalidItemQueryError();
  return ids;
}

export async function getProcessingSnapshots(ids: string[]): Promise<ProcessingSnapshot[]> {
  const user = await requireUser();
  const client = await createClient();
  const { data, error } = await client.from("items").select(processingColumns).eq("user_id", user.id).in("id", ids).limit(100);
  if (error || !data) throw new Error("PROCESSING_READ_FAILED");
  const processing = await projectProcessing(client, data, user.id);
  return data.map(row => ({ id: row.id, processing: processing.get(row.id)! }));
}
