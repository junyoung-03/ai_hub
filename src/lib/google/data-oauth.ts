import "server-only";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GOOGLE_DATA_SCOPES = [
  "openid",
  "email",
  "profile",
  GMAIL_READONLY_SCOPE,
] as const;

const ALLOWED_GRANTED_SCOPES = new Set([
  ...GOOGLE_DATA_SCOPES,
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);

export type GoogleDataOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
};

export type GoogleIdentity = {
  providerAccountId: string;
  email: string;
};

export type GmailProfile = {
  emailAddress: string;
  historyId: string;
};

export class GoogleDataOAuthError extends Error {
  constructor(
    public readonly code:
      | "CONFIGURATION_ERROR"
      | "TOKEN_EXCHANGE_FAILED"
      | "TOKEN_REFRESH_FAILED"
      | "INVALID_SCOPE"
      | "IDENTITY_FAILED"
      | "GMAIL_PROFILE_FAILED",
  ) {
    super(code);
    this.name = "GoogleDataOAuthError";
  }
}

function requiredServerEnv(name: "GOOGLE_DATA_CLIENT_ID" | "GOOGLE_DATA_CLIENT_SECRET" | "GOOGLE_DATA_REDIRECT_URI") {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleDataOAuthError("CONFIGURATION_ERROR");
  return value;
}

export function getGoogleDataOAuthConfig(): GoogleDataOAuthConfig {
  const clientId = requiredServerEnv("GOOGLE_DATA_CLIENT_ID");
  const clientSecret = requiredServerEnv("GOOGLE_DATA_CLIENT_SECRET");
  const redirectUri = requiredServerEnv("GOOGLE_DATA_REDIRECT_URI");

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new GoogleDataOAuthError("CONFIGURATION_ERROR");
  }

  const localHttp = parsed.protocol === "http:" && parsed.hostname === "localhost";
  if (
    (!localHttp && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/api/v1/connections/google/callback"
  ) {
    throw new GoogleDataOAuthError("CONFIGURATION_ERROR");
  }

  return { clientId, clientSecret, redirectUri: parsed.toString() };
}

export function createGoogleAuthorizationUrl(config: GoogleDataOAuthConfig, state: string) {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_DATA_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
  }).toString();
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export function validateGrantedScopes(rawScope: string): string[] {
  const scopes = [...new Set(rawScope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean))].sort();
  if (
    !scopes.includes(GMAIL_READONLY_SCOPE) ||
    scopes.some((scope) => !ALLOWED_GRANTED_SCOPES.has(scope))
  ) {
    throw new GoogleDataOAuthError("INVALID_SCOPE");
  }
  return scopes;
}

export async function exchangeGoogleAuthorizationCode(
  config: GoogleDataOAuthConfig,
  code: string,
): Promise<GoogleTokenSet> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleDataOAuthError("TOKEN_EXCHANGE_FAILED");
  }

  const payload = await safeJson(response);
  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  const refreshToken = typeof payload.refresh_token === "string" && payload.refresh_token.trim()
    ? payload.refresh_token.trim()
    : null;
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number.NaN;
  const rawScope = typeof payload.scope === "string" ? payload.scope : "";
  const tokenType = typeof payload.token_type === "string" ? payload.token_type.toLowerCase() : "";

  if (!response.ok || !accessToken || tokenType !== "bearer" || !Number.isFinite(expiresIn) || expiresIn <= 0 || !rawScope) {
    throw new GoogleDataOAuthError("TOKEN_EXCHANGE_FAILED");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: validateGrantedScopes(rawScope),
  };
}

async function authorizedGoogleGet(endpoint: string, accessToken: string, errorCode: "IDENTITY_FAILED" | "GMAIL_PROFILE_FAILED") {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleDataOAuthError(errorCode);
  }
  const payload = await safeJson(response);
  if (!response.ok) throw new GoogleDataOAuthError(errorCode);
  return payload;
}

export async function fetchGoogleIdentity(accessToken: string): Promise<GoogleIdentity> {
  const payload = await authorizedGoogleGet(USERINFO_ENDPOINT, accessToken, "IDENTITY_FAILED");
  const providerAccountId = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!providerAccountId || providerAccountId.length > 255 || !email || payload.email_verified !== true) {
    throw new GoogleDataOAuthError("IDENTITY_FAILED");
  }
  return { providerAccountId, email };
}

export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const payload = await authorizedGoogleGet(GMAIL_PROFILE_ENDPOINT, accessToken, "GMAIL_PROFILE_FAILED");
  const emailAddress = typeof payload.emailAddress === "string" ? payload.emailAddress.trim() : "";
  const historyId = typeof payload.historyId === "string" ? payload.historyId.trim() : "";
  if (!emailAddress || !/^[0-9]+$/.test(historyId)) {
    throw new GoogleDataOAuthError("GMAIL_PROFILE_FAILED");
  }
  return { emailAddress, historyId };
}

/** Refresh credentials never cross the server-only boundary. */
export async function refreshGoogleAccessToken(refreshToken: string) {
  const config = getGoogleDataOAuthConfig();
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const payload = await safeJson(response);
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token.trim()
      || typeof payload.expires_in !== "number" || !Number.isFinite(payload.expires_in)
      || payload.expires_in <= 0 || payload.expires_in > 86_400
      || typeof payload.token_type !== "string" || payload.token_type.toLowerCase() !== "bearer") {
      throw new GoogleDataOAuthError("TOKEN_REFRESH_FAILED");
    }
    if (typeof payload.scope === "string") validateGrantedScopes(payload.scope);
    return {
      accessToken: payload.access_token.trim(),
      refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token.trim() ? payload.refresh_token.trim() : null,
      tokenExpiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    };
  } catch {
    throw new GoogleDataOAuthError("TOKEN_REFRESH_FAILED");
  }
}
