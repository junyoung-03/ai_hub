import { indexItem } from "@/lib/search/service";
import { SearchError } from "@/lib/search/contract";
import { searchError, searchResponse } from "@/lib/search/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try { const text = await request.text(); if (text.length > 100) throw new SearchError("VALIDATION_ERROR");
    let value: unknown = {}; if (text.trim()) { try { value = JSON.parse(text); } catch { throw new SearchError("VALIDATION_ERROR"); } }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => k !== "retry") || ("retry" in value && typeof value.retry !== "boolean")) throw new SearchError("VALIDATION_ERROR");
    return searchResponse(await indexItem((await context.params).itemId, undefined, undefined, "retry" in value && value.retry === true));
  } catch (error) { return searchError(error); }
}
