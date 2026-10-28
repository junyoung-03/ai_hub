import { authenticateScheduler } from "@/lib/items/free-analysis-config";
import { freeAnalysisScope } from "@/lib/items/free-analysis-scope";
import { analysisJobRpc } from "@/lib/items/analysis-job-rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectScheduledGmail } from "@/lib/google/gmail-collection";
import { GmailCollectionError } from "@/lib/google/gmail-client";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 300;
const safeErrors = new Set(["CONNECTION_REQUIRED", "TOKEN_MISSING", "REFRESH_FAILED", "GMAIL_UNAVAILABLE", "SYNC_IN_PROGRESS", "STORAGE_FAILED"]);
const object = (v: Json | null): { [key:string]: Json | undefined } | null => v && typeof v === "object" && !Array.isArray(v) ? v : null;

/** Scheduler-only, fixed owner. No request can choose a mailbox or content. */
export async function POST(request: Request) {
  try {
    authenticateScheduler(request.headers.get("authorization"), request.headers.get("x-etc-timestamp"), request.headers.get("x-etc-signature"), "/api/internal/gmail-sync");
    const body = (await request.text()).trim();
    if (body && body !== "{}") return Response.json({error:"EMPTY_BODY_REQUIRED"},{status:400});
    const { users } = freeAnalysisScope(), admin = createAdminClient();
    const config = await analysisJobRpc(admin,"gmail_automation_state",{}), state = object(config.data);
    if (config.error || state?.enabled !== true || state.owner !== users[0]) return Response.json({error:"AUTOMATION_DISABLED"},{status:503});
    const lease = await analysisJobRpc(admin,"claim_gmail_sync",{p_owner:users[0]}), token = object(lease.data)?.token;
    if (lease.error) throw new Error("SYNC_STORAGE_UNAVAILABLE");
    if (typeof token !== "string") return Response.json({state:"busy"});
    let result: {collected_count:number;created_count:number;updated_count:number;failed_count:number;complete:boolean;capped:boolean} | null = null;
    let code: string | null = null;
    try { result = await collectScheduledGmail(users[0]); }
    catch (error) { code = error instanceof GmailCollectionError && safeErrors.has(error.code) ? error.code : "SYNC_FAILED"; }
    const outcome = code ? "failed" : result?.complete && !result.capped ? "complete" : "partial";
    if (!code && outcome === "partial") code = result?.capped ? "GMAIL_RESULT_LIMIT" : "GMAIL_PARTIAL_FAILURE";
    const counts = result ? {collected_count:result.collected_count,created_count:result.created_count,updated_count:result.updated_count,failed_count:result.failed_count} : {};
    const saved = await analysisJobRpc(admin,"finish_gmail_sync",{p_owner:users[0],p_token:token,p_state:outcome,p_error_code:code,p_counts:counts});
    if (saved.error || saved.data !== true) throw new Error("SYNC_STORAGE_UNAVAILABLE");
    return Response.json({state:outcome,...counts,...(code ? {error:code} : {})},{status:outcome === "failed" ? 503 : 200,headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 503;
    return Response.json({error:status === 401 ? "UNAUTHORIZED" : "SYNC_UNAVAILABLE"},{status,headers:{"Cache-Control":"no-store"}});
  }
}
