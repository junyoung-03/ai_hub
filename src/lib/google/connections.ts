import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/auth";
import { getGoogleTokenEncryptionKey, openGoogleToken, sealGoogleToken } from "@/lib/google/token-encryption";

export type GoogleConnectionSummary = {
  id: string;
  status: "connected" | "disconnected" | "error";
  accountEmail: string | null;
  lastSyncedAt: string | null;
};

export type GoogleConnectionCandidate = {
  userId: string;
  providerAccountId: string;
  accountEmail: string;
  scopes: string[];
  gmailHistoryId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string;
};

export class GoogleConnectionStorageUnavailableError extends Error {
  constructor() {
    super("Google connection token storage is not available.");
    this.name = "GoogleConnectionStorageUnavailableError";
  }
}

export function assertGoogleConnectionStorageReady(): void {
  getGoogleTokenEncryptionKey();
  try {
    createAdminClient();
  } catch {
    throw new GoogleConnectionStorageUnavailableError();
  }
}

export async function getGoogleConnectionSummary(userId: string): Promise<GoogleConnectionSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("connections")
    .select("id,status,account_email,last_synced_at")
    .eq("user_id", userId)
    .eq("provider", "google")
    .order("updated_at", { ascending: false })
    .limit(2);

  if (error) throw new Error("Unable to read Google connection state.");
  if (data.length > 1) throw new Error("Multiple Google connections require an explicit product decision.");
  const connection = data[0];
  return connection
    ? {
        id: connection.id,
        status: connection.status,
        accountEmail: connection.account_email,
        lastSyncedAt: connection.last_synced_at,
      }
    : null;
}

function tokenContext(userId: string, providerAccountId: string, kind: "access" | "refresh") {
  return JSON.stringify(["google", 1, userId, providerAccountId, kind]);
}

async function verifyOwner(userId: string) {
  const user = await requireUser();
  if (user.id !== userId) throw new Error("Google connection ownership mismatch.");
}

async function getOwnedConnection(userId: string, connectionId: string) {
  await verifyOwner(userId);
  const supabase = await createClient();
  const { data, error } = await supabase.from("connections")
    .select("provider_account_id")
    .eq("id", connectionId).eq("user_id", userId)
    .eq("provider", "google").eq("status", "connected").maybeSingle();
  if (error) throw new Error("Unable to verify Google connection ownership.");
  return data?.provider_account_id ?? null;
}

/** Plaintext credentials stay within this server-only module's callers. */
export async function persistGoogleConnection(candidate: GoogleConnectionCandidate): Promise<void> {
  await verifyOwner(candidate.userId);
  const key = getGoogleTokenEncryptionKey();
  const access = sealGoogleToken(candidate.accessToken, tokenContext(candidate.userId, candidate.providerAccountId, "access"), key);
  const refresh = candidate.refreshToken === null ? null
    : sealGoogleToken(candidate.refreshToken, tokenContext(candidate.userId, candidate.providerAccountId, "refresh"), key);
  const { data, error } = await createAdminClient().rpc("upsert_google_connection", {
    p_user_id: candidate.userId,
    p_provider_account_id: candidate.providerAccountId,
    p_account_email: candidate.accountEmail,
    p_scopes: candidate.scopes,
    p_gmail_history_id: candidate.gmailHistoryId,
    p_access_token_ciphertext: access.ciphertext,
    p_access_token_iv: access.iv,
    p_access_token_tag: access.tag,
    p_refresh_token_ciphertext: refresh?.ciphertext ?? null,
    p_refresh_token_iv: refresh?.iv ?? null,
    p_refresh_token_tag: refresh?.tag ?? null,
    p_token_expires_at: candidate.tokenExpiresAt,
    p_encryption_version: access.version,
  });
  if (error || !data) throw new Error("Unable to store Google connection credentials.");

  // Verify the saved AES-GCM bundle through the same narrow read RPC.
  const saved = await getGoogleConnectionTokens(candidate.userId, data);
  if (!saved || saved.accessToken !== candidate.accessToken
    || (candidate.refreshToken !== null && saved.refreshToken !== candidate.refreshToken)) {
    throw new Error("Unable to verify stored Google credentials.");
  }
}

export async function getGoogleConnectionTokens(userId: string, connectionId: string) {
  const accountId = await getOwnedConnection(userId, connectionId);
  if (!accountId) return null;
  const { data, error } = await createAdminClient().rpc("get_google_connection_tokens", {
    p_user_id: userId, p_connection_id: connectionId,
  });
  if (error || data.length > 1) throw new Error("Unable to read Google credentials.");
  const bundle = data[0];
  if (!bundle) return null;
  if (bundle.encryption_version !== 1) throw new Error("Unsupported Google credential encryption.");
  const key = getGoogleTokenEncryptionKey();
  return {
    accessToken: openGoogleToken({ ciphertext: bundle.access_token_ciphertext, iv: bundle.access_token_iv, tag: bundle.access_token_tag, version: 1 }, tokenContext(userId, accountId, "access"), key),
    refreshToken: openGoogleToken({ ciphertext: bundle.refresh_token_ciphertext, iv: bundle.refresh_token_iv, tag: bundle.refresh_token_tag, version: 1 }, tokenContext(userId, accountId, "refresh"), key),
    expiresAt: bundle.token_expires_at,
  };
}

/** Stores a server-obtained refresh result; does not call Google or collect mail. */
export async function refreshGoogleConnectionTokens(
  userId: string,
  connectionId: string,
  tokens: Pick<GoogleConnectionCandidate, "accessToken" | "refreshToken" | "tokenExpiresAt">,
): Promise<boolean> {
  const accountId = await getOwnedConnection(userId, connectionId);
  if (!accountId) return false;
  const key = getGoogleTokenEncryptionKey();
  const access = sealGoogleToken(tokens.accessToken, tokenContext(userId, accountId, "access"), key);
  const refresh = tokens.refreshToken === null ? null
    : sealGoogleToken(tokens.refreshToken, tokenContext(userId, accountId, "refresh"), key);
  const { data, error } = await createAdminClient().rpc("refresh_google_connection_tokens", {
    p_user_id: userId, p_connection_id: connectionId,
    p_access_token_ciphertext: access.ciphertext, p_access_token_iv: access.iv, p_access_token_tag: access.tag,
    p_refresh_token_ciphertext: refresh?.ciphertext ?? null,
    p_refresh_token_iv: refresh?.iv ?? null, p_refresh_token_tag: refresh?.tag ?? null,
    p_token_expires_at: tokens.tokenExpiresAt, p_encryption_version: access.version,
  });
  if (error) throw new Error("Unable to refresh stored Google credentials.");
  return data;
}

export async function disconnectGoogleConnection(connectionId: string): Promise<void> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("disconnect_google_connection", { p_connection_id: connectionId });
  if (error || !data) throw new Error("Unable to disconnect Google connection.");
}
