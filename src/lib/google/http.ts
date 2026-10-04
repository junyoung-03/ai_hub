import "server-only";

import { randomUUID } from "node:crypto";

import { GoogleConnectionStorageUnavailableError } from "@/lib/google/connections";
import { GoogleDataOAuthError } from "@/lib/google/data-oauth";
import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { GoogleTokenEncryptionUnavailableError } from "@/lib/google/token-encryption";

export function connectionResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}

export function connectionErrorResponse(error: unknown) {
  const unauthorized = error instanceof AuthenticationRequiredError;
  const unavailable = error instanceof GoogleConnectionStorageUnavailableError;
  const encryptionUnavailable = error instanceof GoogleTokenEncryptionUnavailableError;
  const configuration = error instanceof GoogleDataOAuthError && error.code === "CONFIGURATION_ERROR";
  const status = unauthorized ? 401 : unavailable || encryptionUnavailable || configuration ? 503 : 500;
  const code = unauthorized
    ? "UNAUTHORIZED"
    : unavailable || encryptionUnavailable
      ? "TOKEN_STORAGE_UNAVAILABLE"
      : configuration
        ? "GOOGLE_DATA_OAUTH_NOT_CONFIGURED"
        : "INTERNAL_ERROR";
  const message = unauthorized
    ? "로그인이 필요합니다."
    : unavailable || encryptionUnavailable
      ? "Google 연결 저장소 준비가 필요합니다."
      : configuration
        ? "Google 메일 연결 설정이 준비되지 않았습니다."
        : "Google 연결 상태를 처리하지 못했습니다.";

  return connectionResponse({ error: { code, message, details: {}, requestId: randomUUID() } }, status);
}
