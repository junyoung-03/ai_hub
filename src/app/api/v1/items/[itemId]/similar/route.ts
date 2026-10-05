import { similarItems } from "@/lib/search/service";
import { searchError, searchResponse } from "@/lib/search/http";
import { SearchError } from "@/lib/search/contract";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try { const url = new URL(request.url); if ([...url.searchParams.keys()].some(k => k !== "limit") || url.searchParams.getAll("limit").length > 1) throw new SearchError("VALIDATION_ERROR");
    return searchResponse(await similarItems((await context.params).itemId, Number(url.searchParams.get("limit") ?? 5)));
  } catch (error) { return searchError(error); }
}
