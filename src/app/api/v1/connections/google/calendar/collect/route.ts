import { collectCalendar } from "@/lib/google/calendar-collection";
import { CalendarError } from "@/lib/google/calendar-contract";
import { connectionErrorResponse, connectionResponse } from "@/lib/google/http";
export const runtime = "nodejs";
export const maxDuration = 150;
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return connectionResponse({ error: { code: "FORBIDDEN", message: "허용되지 않은 요청입니다.", details: {} } }, 403);
  try {
    // Accept only an absent body or exactly {}. Read bounded bytes, never arbitrary policy input.
    const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (reader) try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 64) { await reader.cancel(); return invalid(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw) {
      let input: unknown; try { input = JSON.parse(raw); } catch { return invalid(); }
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) return invalid();
    }
    return connectionResponse(await collectCalendar());
  } catch (error) {
    if (!(error instanceof CalendarError)) return connectionErrorResponse(error);
    return connectionResponse({ error: { code: error.code, message: "Calendar 연결과 수집 상태를 확인해 주세요.", details: {} } },
      error.code === "CONNECTION_REQUIRED" || error.code === "CALENDAR_CONSENT_REQUIRED" ? 409 : error.code === "REFRESH_FAILED" ? 401 : 502);
  }
}
function invalid() {
  return connectionResponse({ error: { code: "VALIDATION_ERROR", message: "수집 요청에 별도 조건을 지정할 수 없습니다.", details: {} } }, 400);
}
