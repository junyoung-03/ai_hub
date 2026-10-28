import { freeAnalysisConfig } from "@/lib/items/free-analysis-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAnalysisBatch } from "../../../../../workers/analysis/runner";
import { analysisJobRpc } from "@/lib/items/analysis-job-rpc";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Supabase Cron POST; no cookies, user-controlled scope or detached work. */
export async function POST(request: Request) {
  try {
    const { users,items } = freeAnalysisConfig(request.headers.get("authorization"),request.headers.get("x-etc-timestamp"),request.headers.get("x-etc-signature"));
    const body = (await request.text()).trim();
    if (body && body !== "{}") return Response.json({error:"EMPTY_BODY_REQUIRED"},{status:400});
    const admin = createAdminClient();
    const config = await analysisJobRpc(admin,"gmail_automation_state",{});
    // Only a genuinely absent migration may retain the legacy demo behavior.
    if (config.error && !["42883", "PGRST202"].includes(config.error.code ?? "")) throw new Error("AUTOMATION_STATE_UNAVAILABLE");
    const value = config.data && typeof config.data === "object" && !Array.isArray(config.data) ? config.data : null;
    const automatic = !config.error && value?.enabled === true && value.owner === users[0];
    const result = await runAnalysisBatch(admin,users,1,automatic ? undefined : items,automatic);
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 503;
    return Response.json({error:status === 401 ? "UNAUTHORIZED" : "FREE_ANALYSIS_UNAVAILABLE"},{status,headers:{"Cache-Control":"no-store"}});
  }
}
