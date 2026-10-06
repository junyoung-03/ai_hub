import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { ItemWriteError } from "./writes";
export const writeResponse = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" } });
export async function readWriteBody(request: Request, allowEmpty = false) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new ItemWriteError("VALIDATION_ERROR", 403);
  const reader = request.body?.getReader(); if (!reader) { if (allowEmpty) return {}; throw new ItemWriteError("VALIDATION_ERROR"); }
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
      if (size > 8192) { await reader.cancel(); throw new ItemWriteError("VALIDATION_ERROR", 413); } chunks.push(value); }
    const text = Buffer.concat(chunks).toString("utf8"); if (allowEmpty && !text.trim()) return {};
    try { return JSON.parse(text) as unknown; } catch { throw new ItemWriteError("VALIDATION_ERROR"); }
  } finally { reader.releaseLock(); }
}
export function writeErrorResponse(error: unknown) {
  const status = error instanceof AuthenticationRequiredError ? 401 : error instanceof ItemWriteError ? error.status : 500;
  const code = status === 401 ? "UNAUTHORIZED" : error instanceof ItemWriteError ? error.code : "INTERNAL_ERROR";
  return writeResponse({ error: { code, message: status === 401 ? "로그인이 필요합니다." : status === 404 ? "자료 또는 할 일을 찾을 수 없습니다." : "요청을 저장하지 못했습니다. 입력을 확인하고 다시 시도해 주세요." } }, status);
}
