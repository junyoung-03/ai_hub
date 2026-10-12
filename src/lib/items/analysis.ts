import "server-only";
import { analysisEligible, analysisFingerprint } from "@/lib/items/analysis-policy";
export { analysisFingerprint } from "@/lib/items/analysis-policy";
import { analyzeGmailText, getGeminiConfig, GeminiAnalysisError } from "@/lib/gemini/client";
import { AnalysisValidationError, validateAnalysis } from "@/lib/gemini/validation";
import { analysisDateContext, type AnalysisDateContext } from "@/lib/gemini/date-context";
import { isItemId } from "@/lib/items/filters";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ItemAnalysis } from "@/types/analysis";
import type { Json } from "@/types/database";

export class ItemAnalysisError extends Error {
  constructor(public readonly code: "ITEM_NOT_FOUND" | "INVALID_ANALYSIS_INPUT" | "ANALYSIS_IN_PROGRESS" | "ANALYSIS_STORAGE_UNAVAILABLE") { super(code); }
}
type RecordValue = { [key: string]: Json | undefined };
const record = (value: Json | undefined): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value : null;
type PersistenceInput = { userId: string; itemId: string; contentText: string;
  contentHash: string | null; result: ItemAnalysis; model: string; fingerprint: string; eligibleSource?: boolean; dateContext?: AnalysisDateContext };

/** Entire RPC is the retry unit. Never retry only an Action/Evidence statement. */
export async function persistValidatedAnalysis(admin: ReturnType<typeof createAdminClient>, input: PersistenceInput) {
  const result = validateAnalysis(input.result, input.contentText, input.dateContext);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await admin.rpc(input.eligibleSource ? "persist_eligible_item_analysis" : "persist_gmail_item_analysis", {
      p_user_id: input.userId, p_item_id: input.itemId, p_content_text: input.contentText,
      p_content_hash: input.contentHash, p_analysis: result as unknown as Json,
      p_model: input.model, p_input_fingerprint: input.fingerprint,
    });
    if (error) {
      if (["40P01", "40001"].includes(error.code) && attempt < 2) continue;
      throw new ItemAnalysisError("ANALYSIS_STORAGE_UNAVAILABLE");
    }
    const saved = record(data);
    if (!saved || typeof saved.action_count !== "number" || typeof saved.created_count !== "number"
      || typeof saved.reused_count !== "number" || typeof saved.cached !== "boolean") throw new ItemAnalysisError("ANALYSIS_STORAGE_UNAVAILABLE");
    return { action_count: saved.action_count, created_count: saved.created_count,
      reused_count: saved.reused_count, cached: saved.cached, processing_status: "indexing" as const };
  }
  throw new ItemAnalysisError("ANALYSIS_STORAGE_UNAVAILABLE");
}

/** No request body/model-provided user_id can select the analysis owner. */
export async function analyzeOwnedGmailItem(itemId: string) {
  return analyzeOwnedItem(itemId, true);
}
export async function analyzeOwnedItem(itemId: string, gmailOnly = false) {
  const user = await requireUser();
  if (!isItemId(itemId)) throw new ItemAnalysisError("ITEM_NOT_FOUND");
  const supabase = await createClient();
  const { data: item, error } = await supabase.from("items")
    .select("id,source,format,content_text,content_hash,metadata,processing_status,updated_at,created_at,source_created_at")
    .eq("id", itemId).eq("user_id", user.id).maybeSingle();
  if (error) throw new ItemAnalysisError("ANALYSIS_STORAGE_UNAVAILABLE");
  if (!item) throw new ItemAnalysisError("ITEM_NOT_FOUND");
  if (gmailOnly && (item.source !== "gmail" || item.format !== "email")) throw new ItemAnalysisError("ITEM_NOT_FOUND");
  if (!analysisEligible(item)) throw new ItemAnalysisError("INVALID_ANALYSIS_INPUT");
  if (!item.content_text?.trim() || item.content_text.length > 200_000) throw new ItemAnalysisError("INVALID_ANALYSIS_INPUT");
  const { model } = getGeminiConfig();
  const dateContext = analysisDateContext(item);
  const fingerprint = analysisFingerprint(item.content_text, model);
  const artifact = record(record(item.metadata)?.aiAnalysis);
  let resolvedCached: ItemAnalysis | undefined;
  if (artifact?.inputFingerprint === fingerprint && artifact?.model === model && artifact?.schemaVersion === "0.2") {
    const cached = validateAnalysis(artifact.result, item.content_text, dateContext);
    const previous = artifact.result as unknown as ItemAnalysis;
    const observed = [...cached.eventObservations, ...cached.actions.flatMap(action => [action.startObservation, action.deadlineObservation])];
    const prior = [...previous.eventObservations, ...previous.actions.flatMap(action => [action.startObservation, action.deadlineObservation])];
    const dateChanged = observed.some((value, index) => value.status !== prior[index].status || value.date !== prior[index].date || value.datetime !== prior[index].datetime);
    if (!dateChanged) {
      return { cached: true, action_count: cached.actions.length, created_count: 0, reused_count: cached.actions.length, processing_status: item.processing_status };
    }
    // Explicit analysis request can persist the newly approved year interpretation without a provider call.
    resolvedCached = cached;
  }
  if (!["queued", "failed", "indexing", "completed"].includes(item.processing_status)) throw new ItemAnalysisError("ANALYSIS_IN_PROGRESS");
  const { data: topics, error: topicError } = await supabase.from("classifications")
    .select("ai_primary_topic,user_primary_topic").eq("user_id", user.id).limit(200);
  if (topicError) throw new ItemAnalysisError("ANALYSIS_STORAGE_UNAVAILABLE");
  const existingTopics = [...new Set((topics ?? []).map((row) => row.user_primary_topic ?? row.ai_primary_topic)
    .filter((topic): topic is string => Boolean(topic?.trim())))];
  const admin = createAdminClient();
  const { data: claim, error: claimError } = await admin.from("items")
    .update({ processing_status: "analyzing", processing_error: null })
    .eq("id", itemId).eq("user_id", user.id).eq("updated_at", item.updated_at)
    .eq("processing_status", item.processing_status).select("updated_at").maybeSingle();
  if (claimError) throw new ItemAnalysisError("ANALYSIS_STORAGE_UNAVAILABLE");
  if (!claim) throw new ItemAnalysisError("ANALYSIS_IN_PROGRESS");
  try {
    const result = resolvedCached ?? await analyzeGmailText(item.content_text, existingTopics, dateContext);
    return await persistValidatedAnalysis(admin, { userId: user.id, itemId, contentText: item.content_text,
      contentHash: item.content_hash, result, model, fingerprint, eligibleSource: item.source !== "gmail", dateContext });
  } catch (failure) {
    const safeError = failure instanceof AnalysisValidationError ? "ANALYSIS_VALIDATION_FAILED"
      : failure instanceof GeminiAnalysisError ? failure.code : "ANALYSIS_FAILED";
    await admin.from("items").update({ processing_status: "failed", processing_error: safeError })
      .eq("id", itemId).eq("user_id", user.id).eq("updated_at", claim.updated_at).eq("processing_status", "analyzing");
    throw failure;
  }
}
