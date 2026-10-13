import { analyzeGmailText, getGeminiConfig } from "@/lib/gemini/client";
import { analysisFingerprint, analysisCurrent } from "@/lib/items/analysis-policy";
import { analysisFailure } from "@/lib/items/analysis-failure";
import { validateAnalysis } from "@/lib/gemini/validation";
import { analysisJobRpc } from "@/lib/items/analysis-job-rpc";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
type Job = { itemId: string; userId: string; token: string; attempt: number };
function job(value: Json | null): Job | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) || !uuid(value.itemId) || !uuid(value.userId) || !uuid(value.token) || typeof value.attempt !== "number") throw new Error("INVALID_JOB_RESULT");
  return { itemId:value.itemId,userId:value.userId,token:value.token,attempt:value.attempt };
}

/** Bounded invocation; Scheduler calls again to drain remaining/delayed jobs. */
export async function runAnalysisBatch(admin: SupabaseClient<Database>, allowedUsers: string[], maxJobs = 3, demoItemIds?: string[]) {
  if (!allowedUsers.length || allowedUsers.length > 100 || allowedUsers.some(id => !uuid(id))) throw new Error("EXPLICIT_OWNER_SCOPE_REQUIRED");
  if (process.env.PROMOTIONAL_NOISE_ENABLED === "true") throw new Error("PROMOTIONAL_MUST_REMAIN_OFF");
  if (demoItemIds && (!demoItemIds.length || demoItemIds.length > 3 || demoItemIds.some(id => !uuid(id)))) throw new Error("EXPLICIT_DEMO_SCOPE_REQUIRED");
  const { model } = getGeminiConfig();
  const counts = { complete:0, retry:0, failed:0, stale:0 };
  const end = Date.now() + 240_000;
  for (let n=0; n<Math.min(3,Math.max(0,maxJobs)) && Date.now()<end-85_000; n++) {
    const claim = await analysisJobRpc(admin,demoItemIds ? "claim_free_gmail_analysis_job" : "claim_gmail_analysis_job",
      {p_allowed_users:allowedUsers,...(demoItemIds ? {p_item_ids:demoItemIds} : {})});
    if (claim.error) throw new Error("JOB_STORAGE_UNAVAILABLE");
    const current = job(claim.data); if (!current) break;
    if (!allowedUsers.includes(current.userId)) throw new Error("JOB_OWNER_MISMATCH");
    if (demoItemIds && !demoItemIds.includes(current.itemId)) throw new Error("JOB_DEMO_SCOPE_MISMATCH");
    const base = {p_user_id:current.userId,p_item_id:current.itemId,p_token:current.token};
    try {
      const { data:item,error } = await admin.from("items").select("source,format,content_text,metadata").eq("id",current.itemId).eq("user_id",current.userId).single();
      if (error || !item?.content_text) throw new Error("ANALYSIS_STORAGE_UNAVAILABLE");
      // Cached results still pass the unchanged DB RPC and its evidence checks.
      const artifact = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata.aiAnalysis : null;
      const stored = artifact && typeof artifact === "object" && !Array.isArray(artifact) ? artifact : null;
      // Automatic processing must not invalidate a successful unchanged source just
      // because the deployment selected a different provider model.
      const storedModel = typeof stored?.model === "string" ? stored.model : model;
      const cache = stored?.schemaVersion === "0.2" && analysisCurrent(item,storedModel) ? stored.result : null;
      const resultModel = cache ? storedModel : model;
      const topics = await admin.from("classifications").select("ai_primary_topic,user_primary_topic").eq("user_id",current.userId).limit(200);
      if (topics.error) throw new Error("ANALYSIS_STORAGE_UNAVAILABLE");
      const names = [...new Set((topics.data ?? []).map(r=>r.user_primary_topic ?? r.ai_primary_topic).filter((v):v is string=>!!v?.trim()))];
      const result = cache ? validateAnalysis(cache,item.content_text) : await analyzeGmailText(item.content_text,names,undefined,"0.2",demoItemIds ? {maxAttempts:1} : undefined);
      const saved = await analysisJobRpc(admin,"finish_gmail_analysis_job",{...base,p_analysis:result as Json,p_model:resultModel,
        p_fingerprint:analysisFingerprint(item.content_text,resultModel,"0.2"),p_error_code:null});
      if (saved.error) {
        if (saved.error.code === "PT409") { counts.stale++; continue; }
        throw new Error(["22023","23514","42501"].includes(saved.error.code ?? "") ? "ANALYSIS_PERSISTENCE_REJECTED" : "ANALYSIS_STORAGE_UNAVAILABLE");
      }
      if (saved.data && typeof saved.data === "object" && !Array.isArray(saved.data) && saved.data.stale) counts.stale++; else counts.complete++;
    } catch (error) {
      const failure = analysisFailure(error,current.attempt);
      if (demoItemIds && failure.code === "GEMINI_HTTP_429") failure.retrySeconds = Math.max(3600,failure.retrySeconds ?? 3600);
      const saved = await analysisJobRpc(admin,"finish_gmail_analysis_job",{...base,p_analysis:null,p_model:model,p_fingerprint:null,
        p_error_code:failure.code,p_retry_seconds:failure.retrySeconds});
      if (saved.error) { if (saved.error.code === "PT409") { counts.stale++; continue; } throw new Error("JOB_STORAGE_UNAVAILABLE"); }
      const state = saved.data && typeof saved.data === "object" && !Array.isArray(saved.data) ? saved.data.state : null;
      if (state === "retry") counts.retry++; else if (state === "pending") counts.stale++; else counts.failed++;
    }
  }
  return counts;
}
