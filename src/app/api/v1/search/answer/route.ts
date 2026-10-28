import { groundedAnswer } from "@/lib/search/grounded-answer";
import { SearchError } from "@/lib/search/contract";
import { searchError, searchResponse } from "@/lib/search/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new SearchError("FORBIDDEN", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new SearchError("VALIDATION_ERROR", 415);
    if (Number(request.headers.get("content-length") ?? 0) > 16_384) throw new SearchError("VALIDATION_ERROR", 413);
    const body = await request.text();
    if (Buffer.byteLength(body) > 16_384) throw new SearchError("VALIDATION_ERROR", 413);
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new SearchError("VALIDATION_ERROR"); }
    return searchResponse(await groundedAnswer(value));
  } catch (error) {
    // Safe operational code only; never log the query, source excerpts, provider body or credentials.
    console.warn(JSON.stringify({ event: "grounded_answer_failed", code: error instanceof SearchError ? error.code : "INTERNAL_ERROR" }));
    return searchError(error);
  }
}
