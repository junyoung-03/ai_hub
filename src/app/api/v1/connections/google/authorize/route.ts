import { NextResponse } from "next/server";

import { assertGoogleConnectionStorageReady } from "@/lib/google/connections";
import { createGoogleAuthorizationUrl, getGoogleDataOAuthConfig } from "@/lib/google/data-oauth";
import { connectionErrorResponse } from "@/lib/google/http";
import { createGoogleOAuthState } from "@/lib/google/oauth-state";
import { GOOGLE_OAUTH_CALLBACK_PATH, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google/oauth-state";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await requireUser();
    const config = getGoogleDataOAuthConfig();
    // Do not start consent while the returned refresh token cannot be stored.
    assertGoogleConnectionStorageReady();
    const { state, cookieValue } = createGoogleOAuthState(user.id, config.clientSecret);
    const response = NextResponse.json(
      { authorizationUrl: createGoogleAuthorizationUrl(config, state) },
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
