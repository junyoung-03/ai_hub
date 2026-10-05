import { NextResponse } from "next/server";

import { assertGoogleConnectionStorageReady, getGoogleOAuthConnection } from "@/lib/google/connections";
import { createGoogleAuthorizationUrl, getGoogleDataOAuthConfig } from "@/lib/google/data-oauth";
import { connectionErrorResponse, connectionResponse } from "@/lib/google/http";
import { createGoogleOAuthState } from "@/lib/google/oauth-state";
import { GOOGLE_OAUTH_CALLBACK_PATH, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google/oauth-state";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return connectionResponse({ error: { code: "FORBIDDEN", message: "허용되지 않은 요청입니다.", details: {} } }, 403);
  try {
    const user = await requireUser();
    const body = await request.text();
    let purpose: "connect" | "drive_scope_upgrade" = "connect";
    if (body) {
      let value: unknown;
      try { value = body.length <= 256 ? JSON.parse(body) : null; } catch { value = null; }
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1
        || !("purpose" in value) || value.purpose !== "drive_scope_upgrade")
        return connectionResponse({ error: { code: "VALIDATION_ERROR", message: "연결 요청 형식을 확인해 주세요.", details: {} } }, 400);
      purpose = "drive_scope_upgrade";
    }
    const config = getGoogleDataOAuthConfig();
    // Do not start consent while the returned refresh token cannot be stored.
    assertGoogleConnectionStorageReady();
    const current = await getGoogleOAuthConnection(user.id);
    if (purpose === "drive_scope_upgrade" && (!current || current.status !== "connected" || !current.provider_account_id))
      return connectionResponse({ error: { code: "CONNECTION_REQUIRED", message: "기존 Google 메일 연결이 필요합니다.", details: {} } }, 409);
    const { state, cookieValue } = createGoogleOAuthState(user.id, config.clientSecret, {
      purpose, connectionId: purpose === "drive_scope_upgrade" ? current?.id ?? null : null,
      accountId: purpose === "drive_scope_upgrade" ? current?.provider_account_id ?? null : null,
      connectionUpdatedAt: purpose === "drive_scope_upgrade" ? current?.updated_at ?? null : null,
    });
    const response = NextResponse.json(
      { authorizationUrl: createGoogleAuthorizationUrl(config, state, purpose, current?.scopes ?? []) },
      { headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" } },
    );
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60,
      path: GOOGLE_OAUTH_CALLBACK_PATH,
    });
    return response;
  } catch (error) {
    return connectionErrorResponse(error);
  }
}
