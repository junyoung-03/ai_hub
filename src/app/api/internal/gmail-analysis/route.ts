import { freeAnalysisConfig } from "@/lib/items/free-analysis-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAnalysisBatch } from "../../../../../workers/analysis/runner";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Supabase Cron POST; no cookies, user-controlled scope or detached work. */
export async function POST(request: Request) {
  try {
    const { users,items } = freeAnalysisConfig(request.headers.get("authorization"),request.headers.get("x-etc-timestamp"),request.headers.get("x-etc-signature"));
    const body = (await request.text()).trim();
    if (body && body !== "{}") return Response.json({error:"EMPTY_BODY_REQUIRED"},{status:400});
    const result = await runAnalysisBatch(createAdminClient(),users,1,items);
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 503;
    return Response.json({error:status === 401 ? "UNAUTHORIZED" : "FREE_ANALYSIS_UNAVAILABLE"},{status,headers:{"Cache-Control":"no-store"}});
  }
}
