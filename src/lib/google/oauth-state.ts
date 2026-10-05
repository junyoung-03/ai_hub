import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export type OAuthContext = {
  purpose: "connect" | "drive_scope_upgrade";
  connectionId: string | null;
  accountId: string | null;
  connectionUpdatedAt: string | null;
};

export const GOOGLE_OAUTH_STATE_COOKIE = "ai_hub_google_data_oauth_state";
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/v1/connections/google/callback";

function sign(value: string, signingSecret: string) {
  return createHmac("sha256", signingSecret).update(value).digest("base64url");
}

export function createGoogleOAuthState(userId: string, signingSecret: string, context: OAuthContext = {
  purpose: "connect", connectionId: null, accountId: null, connectionUpdatedAt: null,
}) {
  const state = randomBytes(32).toString("base64url");
  const value = Buffer.from(JSON.stringify({ ...context, state, userId, expiresAt: Date.now() + 600_000 })).toString("base64url");
  return { state, cookieValue: `${value}.${sign(value, signingSecret)}` };
}

export function readGoogleOAuthState(
  returnedState: string,
  cookieValue: string | undefined,
  currentUserId: string,
  signingSecret: string,
): OAuthContext | null {
  if (!STATE_PATTERN.test(returnedState) || !cookieValue || cookieValue.length > 4096) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2 || !SIGNATURE_PATTERN.test(parts[1])) return null;
  const expected = sign(parts[0], signingSecret);
  const actualBuffer = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.state !== returnedState || record.userId !== currentUserId || !USER_ID_PATTERN.test(currentUserId)
      || typeof record.expiresAt !== "number" || record.expiresAt <= Date.now() || record.expiresAt > Date.now() + 600_000) return null;
    if (record.purpose === "connect" && record.connectionId === null && record.accountId === null && record.connectionUpdatedAt === null)
      return { purpose: "connect", connectionId: null, accountId: null, connectionUpdatedAt: null };
    if (record.purpose === "drive_scope_upgrade" && typeof record.connectionId === "string" && USER_ID_PATTERN.test(record.connectionId)
      && typeof record.accountId === "string" && record.accountId.length > 0 && record.accountId.length <= 255
      && typeof record.connectionUpdatedAt === "string" && Number.isFinite(Date.parse(record.connectionUpdatedAt)))
      return { purpose: "drive_scope_upgrade", connectionId: record.connectionId, accountId: record.accountId, connectionUpdatedAt: record.connectionUpdatedAt };
  } catch { /* Malformed signed payloads cannot select an OAuth purpose. */ }
  return null;
}

export function verifyGoogleOAuthState(state: string, cookie: string | undefined, userId: string, secret: string) {
  return readGoogleOAuthState(state, cookie, userId, secret) !== null;
}
