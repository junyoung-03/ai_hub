import "server-only";
import { randomUUID } from "node:crypto";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { SearchError } from "./contract";
export function searchResponse(value: unknown, status = 200, retryAfter?: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Search-Debounce-Ms": "350",
    ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}
export function searchError(error: unknown) {
  const unauthorized = error instanceof AuthenticationRequiredError, known = error instanceof SearchError;
  return searchResponse({ error: { code: unauthorized ? "UNAUTHORIZED" : known ? error.code : "INTERNAL_ERROR",
    message: unauthorized ? "로그인이 필요합니다." : "검색 요청을 완료하지 못했습니다.", requestId: randomUUID() } },
    unauthorized ? 401 : known ? error.status : 500, known ? error.retryAfter : undefined);
}
