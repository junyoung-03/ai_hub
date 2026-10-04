import { collectInitialGmail } from "@/lib/google/gmail-collection";
import { GmailCollectionError } from "@/lib/google/gmail-client";
import { connectionErrorResponse, connectionResponse } from "@/lib/google/http";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  // Cookie-authenticated mutations accept same-origin requests only.
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return connectionResponse({ error: { code: "FORBIDDEN", message: "허용되지 않은 요청입니다.", details: {} } }, 403);
  }
  try { return connectionResponse(await collectInitialGmail()); }
  catch (error) {
    if (!(error instanceof GmailCollectionError)) return connectionErrorResponse(error);
    const messages = {
      CONNECTION_REQUIRED: "Google 메일을 먼저 연결해 주세요.",
      TOKEN_MISSING: "저장된 연결 인증이 없습니다. Google 메일을 재연결해 주세요.",
      REFRESH_FAILED: "Google 연결 인증을 갱신하지 못했습니다. 재연결 후 다시 시도해 주세요.",
      GMAIL_UNAVAILABLE: "Gmail을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      SYNC_IN_PROGRESS: "이미 메일을 수집하고 있습니다. 완료 후 다시 시도해 주세요.",
      STORAGE_FAILED: "메일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
    const status = error.code === "CONNECTION_REQUIRED" || error.code === "TOKEN_MISSING" || error.code === "SYNC_IN_PROGRESS" ? 409 : error.code === "REFRESH_FAILED" ? 401 : 502;
    return connectionResponse({ error: { code: error.code, message: messages[error.code], details: {} } }, status);
  }
}
