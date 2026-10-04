import "server-only";

import { randomUUID } from "node:crypto";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { InvalidItemQueryError } from "@/lib/items/filters";

export function itemResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function itemNotFound() {
  return itemResponse({ error: { code: "NOT_FOUND", message: "자료를 찾을 수 없습니다.", details: {}, requestId: randomUUID() } }, 404);
}
export function itemErrorResponse(error: unknown) {
  const unauthorized = error instanceof AuthenticationRequiredError;
  const invalid = error instanceof InvalidItemQueryError;
  return itemResponse({ error: {
    code: unauthorized ? "UNAUTHORIZED" : invalid ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
    message: unauthorized ? "로그인이 필요합니다." : invalid ? error.message : "자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    details: {}, requestId: randomUUID(),
  } }, unauthorized ? 401 : invalid ? 400 : 500);
}
