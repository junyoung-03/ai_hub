import { analyzeOwnedItem, ItemAnalysisError } from "@/lib/items/analysis";
import { GeminiAnalysisError } from "@/lib/gemini/client";
import { AnalysisValidationError } from "@/lib/gemini/validation";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { readWriteBody, writeErrorResponse } from "@/lib/items/write-http";
import { ItemWriteError } from "@/lib/items/writes";
export const runtime = "nodejs";
export const maxDuration = 180;
const reply = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
});
export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: { code: "FORBIDDEN", message: "허용되지 않은 요청입니다." } }, 403);
  try {
    const body = await readWriteBody(request, true);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return reply({ error: { code: "VALIDATION_ERROR", message: "분석 요청에는 옵션을 지정할 수 없습니다." } }, 400);
    const result = await analyzeOwnedItem((await context.params).itemId);
    return reply(result, "queued" in result && result.queued ? 202 : 200);
  }
  catch (error) {
    if (error instanceof ItemWriteError) return writeErrorResponse(error);
    if (error instanceof AuthenticationRequiredError) return reply({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    if (error instanceof ItemAnalysisError) return reply({ error: { code: error.code, message: error.code === "ANALYSIS_SCOPE_UNAVAILABLE"
      ? "이 자료는 현재 자동 분석 허용 대상에 포함되지 않았습니다." : error.code === "ANALYSIS_WORKER_PAUSED"
      ? "자동 분석 일정이 중지됐거나 당일 처리 한도에 도달하여 요청을 접수하지 않았습니다. 운영 설정을 확인해 주세요." : error.code === "ANALYSIS_WORKER_UNAVAILABLE"
      ? "자동 분석이 현재 준비되지 않았습니다. 설정을 확인해 주세요." : "현재 ITEM을 분석할 수 없습니다. 내용과 처리 상태를 확인해 주세요." } },
      error.code === "ITEM_NOT_FOUND" ? 404 : error.code === "ANALYSIS_SCOPE_UNAVAILABLE" ? 403 : error.code === "ANALYSIS_IN_PROGRESS" ? 409 : error.code === "INVALID_ANALYSIS_INPUT" ? 422 : 503);
    if (error instanceof GeminiAnalysisError || error instanceof AnalysisValidationError) return reply({ error: {
      code: error instanceof GeminiAnalysisError ? error.code : "ANALYSIS_VALIDATION_FAILED", message: "AI 분석을 완료하지 못했습니다. 유효한 분석 결과만 저장됩니다." } }, error instanceof AnalysisValidationError ? 422 : 503);
    return reply({ error: { code: "INTERNAL_ERROR", message: "AI 분석을 완료하지 못했습니다." } }, 500);
  }
}
