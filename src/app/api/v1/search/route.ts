import { search } from "@/lib/search/service";
import { SearchError } from "@/lib/search/contract";
import { searchError, searchResponse } from "@/lib/search/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 16_384) throw new SearchError("VALIDATION_ERROR", 413);
    const body = await request.text(); if (Buffer.byteLength(body) > 16_384) throw new SearchError("VALIDATION_ERROR", 413);
    let value: unknown; try { value = JSON.parse(body); } catch { throw new SearchError("VALIDATION_ERROR"); }
    return searchResponse(await search(value));
  } catch (error) { return searchError(error); }
}
