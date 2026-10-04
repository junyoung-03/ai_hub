import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const GOOGLE_OAUTH_STATE_COOKIE = "ai_hub_google_data_oauth_state";
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/v1/connections/google/callback";

function sign(value: string, signingSecret: string) {
  return createHmac("sha256", signingSecret).update(value).digest("base64url");
}

export function createGoogleOAuthState(userId: string, signingSecret: string) {
  const state = randomBytes(32).toString("base64url");
  const value = `${state}.${userId}`;
  return { state, cookieValue: `${value}.${sign(value, signingSecret)}` };
}

export function verifyGoogleOAuthState(
  returnedState: string,
  cookieValue: string | undefined,
  currentUserId: string,
  signingSecret: string,
) {
  if (!STATE_PATTERN.test(returnedState) || !cookieValue) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [storedState, storedUserId, signature] = parts;
  if (
    storedState !== returnedState ||
    storedUserId !== currentUserId ||
    !USER_ID_PATTERN.test(storedUserId) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return false;
  }

  const expected = sign(`${storedState}.${storedUserId}`, signingSecret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
