import { NextResponse, type NextRequest } from "next/server";

import {
  GoogleConnectionStorageUnavailableError,
  persistGoogleConnection,
  getGoogleOAuthConnection,
  getGoogleConnectionTokens,
  persistGoogleScopeUpgrade,
} from "@/lib/google/connections";
import {
  exchangeGoogleAuthorizationCode,
  fetchGmailProfile,
  fetchGoogleIdentity,
  getGoogleDataOAuthConfig,
  GoogleDataOAuthError,
  refreshGoogleAccessToken,
  validateGrantedScopes,
} from "@/lib/google/data-oauth";
import { readGoogleOAuthState } from "@/lib/google/oauth-state";
import { GOOGLE_OAUTH_CALLBACK_PATH, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google/oauth-state";
import { AuthenticationRequiredError, requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";

type CallbackResult =
  | "connected"
  | "drive_connected"
  | "calendar_connected"
  | "denied"
  | "invalid_state"
  | "oauth_failed"
  | "scope_error"
  | "profile_failed"
  | "storage_unavailable";

function finish(result: CallbackResult) {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: `/settings?connection=${result}`,
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
    },
  });
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: GOOGLE_OAUTH_CALLBACK_PATH,
  });
  return response;
}

function oneParameter(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  return values.length === 1 && values[0]?.trim() ? values[0].trim() : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = oneParameter(params, "state");
  if (!state) return finish("invalid_state");

  try {
    const user = await requireUser();
    const config = getGoogleDataOAuthConfig();
    const context = readGoogleOAuthState(
      state,
      request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value,
      user.id,
      config.clientSecret,
    );
    if (!context) {
      return finish("invalid_state");
    }

    if (params.has("error")) return finish("denied");
    const code = oneParameter(params, "code");
    if (!code) return finish("oauth_failed");

    const current = await getGoogleOAuthConnection(user.id);
    if (context.purpose !== "connect" && (!current || current.status !== "connected"
      || current.id !== context.connectionId || current.provider_account_id !== context.accountId
      || current.updated_at !== context.connectionUpdatedAt)) return finish("storage_unavailable");
    const tokens = await exchangeGoogleAuthorizationCode(config, code, context.purpose, current?.scopes ?? []);
    if (context.purpose !== "connect" && current && context.connectionUpdatedAt) {
      const identity = await fetchGoogleIdentity(tokens.accessToken);
      if (identity.providerAccountId !== context.accountId) return finish("profile_failed");
      const saved = await getGoogleConnectionTokens(user.id, current.id);
      if (!saved) return finish("storage_unavailable");
      // Prove offline capability BEFORE replacing the saved bundle, even if Google omitted a new refresh token.
      const refreshToken = tokens.refreshToken ?? saved.refreshToken;
      if (!refreshToken) return finish("storage_unavailable");
      const refreshed = await refreshGoogleAccessToken(refreshToken, tokens.scopes, true);
      const scopes = validateGrantedScopes((refreshed.scopes ?? []).join(" "), context.purpose, current.scopes);
      const [refreshedIdentity, gmail] = await Promise.all([
        fetchGoogleIdentity(refreshed.accessToken), fetchGmailProfile(refreshed.accessToken),
      ]);
      if (refreshedIdentity.providerAccountId !== context.accountId
        || refreshedIdentity.email.toLowerCase() !== gmail.emailAddress.toLowerCase()) return finish("profile_failed");
      await persistGoogleScopeUpgrade({
        purpose: context.purpose, userId: user.id, connectionId: current.id, providerAccountId: identity.providerAccountId,
        accountEmail: refreshedIdentity.email, scopes, accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken, tokenExpiresAt: refreshed.tokenExpiresAt,
        expectedConnectionUpdatedAt: context.connectionUpdatedAt, expectedAccessTokenCiphertext: saved.accessTokenCiphertext,
      });
      return finish(context.purpose === "calendar_scope_upgrade" ? "calendar_connected" : "drive_connected");
    }
    const [identity, gmailProfile] = await Promise.all([
      fetchGoogleIdentity(tokens.accessToken),
      fetchGmailProfile(tokens.accessToken),
    ]);
    if (identity.email.toLowerCase() !== gmailProfile.emailAddress.toLowerCase()) {
      return finish("profile_failed");
    }
    if (current?.status === "connected" && identity.providerAccountId !== current.provider_account_id)
      return finish("profile_failed");

    await persistGoogleConnection({
      userId: user.id,
      providerAccountId: identity.providerAccountId,
      accountEmail: gmailProfile.emailAddress,
      scopes: tokens.scopes,
      gmailHistoryId: gmailProfile.historyId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
    });
    return finish("connected");
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return finish("oauth_failed");
    if (error instanceof GoogleConnectionStorageUnavailableError) return finish("storage_unavailable");
    if (error instanceof GoogleDataOAuthError) {
      if (error.code === "INVALID_SCOPE") return finish("scope_error");
      if (error.code === "IDENTITY_FAILED" || error.code === "GMAIL_PROFILE_FAILED") {
        return finish("profile_failed");
      }
    }
    return finish("oauth_failed");
  }
}
