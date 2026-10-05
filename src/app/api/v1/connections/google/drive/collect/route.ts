import { collectDrive } from "@/lib/google/drive-collection";
import { DriveError, parseDriveInput } from "@/lib/google/drive-contract";
import { connectionErrorResponse, connectionResponse } from "@/lib/google/http";
export const runtime = "nodejs";
// 120s collection deadline plus auth/response margin. Deployment must support this value.
export const maxDuration = 150;
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); return ""; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return connectionResponse({ error: { code: "FORBIDDEN", message: "허용되지 않은 요청입니다.", details: {} } }, 403);
  try {
    const raw = await readBody(request);
    let input = null;
    if (raw.length <= 8192) { try { input = parseDriveInput(JSON.parse(raw)); } catch { /* invalid JSON */ } }
    if (!input) return connectionResponse({ error: { code: "VALIDATION_ERROR", message: "폴더 또는 파일 목록 하나를 지정해 주세요.", details: {} } }, 400);
    return connectionResponse(await collectDrive(input));
  } catch (error) {
    if (!(error instanceof DriveError)) return connectionErrorResponse(error);
    const code = error.code;
    return connectionResponse({ error: { code, message: "Drive 연결과 수집 대상을 확인해 주세요.", details: {} } },
      code === "CONNECTION_REQUIRED" || code === "DRIVE_CONSENT_REQUIRED" ? 409 : code === "REFRESH_FAILED" ? 401 : 502);
  }
}
