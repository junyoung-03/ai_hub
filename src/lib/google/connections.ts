import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/auth";
import { getGoogleTokenEncryptionKey, openGoogleToken, sealGoogleToken } from "@/lib/google/token-encryption";
import { validateGrantedScopes } from "@/lib/google/data-oauth";

export type GoogleConnectionSummary = {
  id: string;
  status: "connected" | "disconnected" | "error";
  accountEmail: string | null;
  lastSyncedAt: string | null;
  capabilities: { gmail: boolean; drive: boolean; calendar: boolean };
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

export type GoogleServiceSyncStatus = "connected" | "disconnected" | "syncing" | "error" | "reconnect_required";

export type GoogleServiceSyncSummary = {
  status: GoogleServiceSyncStatus;
  lastSyncedAt: string | null;
  lastResult: Record<string, unknown> | null;
  error?: string | null;
};

export type GoogleConnectionDetailSummary = {
  googleAccount: {
    email: string | null;
    connected: boolean;
    status: "connected" | "disconnected" | "error";
    lastSyncedAt: string | null;
  };
  services: {
    gmail: GoogleServiceSyncSummary;
    drive: GoogleServiceSyncSummary;
    calendar: GoogleServiceSyncSummary;
  };
};

export async function getGoogleConnectionSummary(userId: string): Promise<GoogleConnectionSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("connections")
    .select("id,status,account_email,last_synced_at,scopes")
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
        capabilities: {
          gmail: connection.scopes.includes("https://www.googleapis.com/auth/gmail.readonly"),
          drive: ["https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/documents.readonly"].every(scope => connection.scopes.includes(scope)),
          calendar: connection.scopes.includes("https://www.googleapis.com/auth/calendar.events.owned.readonly"),
        },
      }
    : null;
}

export async function getGoogleServicesSyncSummary(userId: string): Promise<GoogleConnectionDetailSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("connections")
    .select("id,status,account_email,last_synced_at,scopes,sync_state")
    .eq("user_id", userId)
    .eq("provider", "google")
    .order("updated_at", { ascending: false })
    .limit(2);

  if (error) throw new Error("Unable to read Google connection sync state.");
  const connection = data && data.length > 0 ? data[0] : null;

  if (!connection || connection.status !== "connected") {
    return {
      googleAccount: {
        email: connection?.account_email ?? null,
        connected: false,
        status: connection?.status ?? "disconnected",
        lastSyncedAt: connection?.last_synced_at ?? null,
      },
      services: {
        gmail: { status: "disconnected", lastSyncedAt: null, lastResult: null },
        drive: { status: "disconnected", lastSyncedAt: null, lastResult: null },
        calendar: { status: "disconnected", lastSyncedAt: null, lastResult: null },
      },
    };
  }

  const scopes = Array.isArray(connection.scopes) ? connection.scopes : [];
  const hasGmailScope = scopes.includes("https://www.googleapis.com/auth/gmail.readonly");
  const hasDriveScope = ["https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/documents.readonly"].every(s => scopes.includes(s));
  const hasCalendarScope = scopes.includes("https://www.googleapis.com/auth/calendar.events.owned.readonly");

  const syncState = (connection.sync_state && typeof connection.sync_state === "object" && !Array.isArray(connection.sync_state))
    ? (connection.sync_state as Record<string, unknown>)
    : {};
  const gmailSync = (syncState.gmail && typeof syncState.gmail === "object" && !Array.isArray(syncState.gmail))
    ? (syncState.gmail as Record<string, unknown>)
    : {};
  const driveSync = (syncState.drive && typeof syncState.drive === "object" && !Array.isArray(syncState.drive))
    ? (syncState.drive as Record<string, unknown>)
    : {};
  const calendarSync = (syncState.calendar && typeof syncState.calendar === "object" && !Array.isArray(syncState.calendar))
    ? (syncState.calendar as Record<string, unknown>)
    : {};

  let driveLastSyncedAt: string | null = typeof driveSync.last_synced_at === "string" ? driveSync.last_synced_at : null;
  let calendarLastSyncedAt: string | null = typeof calendarSync.last_synced_at === "string" ? calendarSync.last_synced_at : null;

  // Fallback to latest item timestamp if sync_state not yet populated
  if (!driveLastSyncedAt && hasDriveScope) {
    const { data: latestDrive } = await supabase
      .from("items")
      .select("created_at")
      .eq("user_id", userId)
      .eq("source", "drive")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestDrive?.created_at) driveLastSyncedAt = latestDrive.created_at;
  }
  if (!calendarLastSyncedAt && hasCalendarScope) {
    const { data: latestCal } = await supabase
      .from("items")
      .select("created_at")
      .eq("user_id", userId)
      .eq("source", "calendar")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestCal?.created_at) calendarLastSyncedAt = latestCal.created_at;
  }

  const initialColl = gmailSync.initial_collection && typeof gmailSync.initial_collection === "object"
    ? (gmailSync.initial_collection as Record<string, unknown>)
    : null;
  const gmailLastSyncedAt: string | null = typeof gmailSync.last_synced_at === "string"
    ? gmailSync.last_synced_at
    : (typeof initialColl?.completed_at === "string" ? initialColl.completed_at : connection.last_synced_at);

  const getStatus = (hasScope: boolean, serviceSync: Record<string, unknown>): GoogleServiceSyncStatus => {
    if (!hasScope) return "reconnect_required";
    if (serviceSync.last_error === "reconnect_required") return "reconnect_required";
    if (typeof serviceSync.last_error === "string" && serviceSync.last_error) return "error";
    return "connected";
  };

  return {
    googleAccount: {
      email: connection.account_email,
      connected: true,
      status: "connected",
      lastSyncedAt: connection.last_synced_at,
    },
    services: {
      gmail: {
        status: getStatus(hasGmailScope, gmailSync),
        lastSyncedAt: gmailLastSyncedAt,
        lastResult: (gmailSync.last_result && typeof gmailSync.last_result === "object") ? gmailSync.last_result as Record<string, unknown> : null,
        error: typeof gmailSync.last_error === "string" ? gmailSync.last_error : null,
      },
      drive: {
        status: getStatus(hasDriveScope, driveSync),
        lastSyncedAt: driveLastSyncedAt,
        lastResult: (driveSync.last_result && typeof driveSync.last_result === "object") ? driveSync.last_result as Record<string, unknown> : null,
        error: typeof driveSync.last_error === "string" ? driveSync.last_error : null,
      },
      calendar: {
        status: getStatus(hasCalendarScope, calendarSync),
        lastSyncedAt: calendarLastSyncedAt,
        lastResult: (calendarSync.last_result && typeof calendarSync.last_result === "object") ? calendarSync.last_result as Record<string, unknown> : null,
        error: typeof calendarSync.last_error === "string" ? calendarSync.last_error : null,
      },
    },
  };
}

function tokenContext(userId: string, providerAccountId: string, kind: "access" | "refresh") {
  return JSON.stringify(["google", 1, userId, providerAccountId, kind]);
}

async function verifyOwner(userId: string) {
  const user = await requireUser();
  if (user.id !== userId) throw new Error("Google connection ownership mismatch.");
}

/** Server OAuth context, excluded from public JSON. Identity is bound in the signed HttpOnly state cookie. */
export async function getGoogleOAuthConnection(userId: string) {
  await verifyOwner(userId);
  const client = await createClient();
  const { data, error } = await client.from("connections")
    .select("id,provider_account_id,status,scopes,updated_at")
    .eq("user_id", userId).eq("provider", "google").order("updated_at", { ascending: false }).limit(2);
  if (error || data.length > 1) throw new GoogleConnectionStorageUnavailableError();
  return data[0] ?? null;
}

async function getOwnedConnection(userId: string, connectionId: string) {
  await verifyOwner(userId);
  const supabase = await createClient();
  const { data, error } = await supabase.from("connections")
    .select("provider_account_id,scopes")
    .eq("id", connectionId).eq("user_id", userId)
    .eq("provider", "google").eq("status", "connected").maybeSingle();
  if (error) throw new Error("Unable to verify Google connection ownership.");
  return data?.provider_account_id ? { accountId: data.provider_account_id, scopes: data.scopes ?? [] } : null;
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
  const owned = await getOwnedConnection(userId, connectionId);
  if (!owned) return null;
  const accountId = owned.accountId;
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
    accessTokenCiphertext: bundle.access_token_ciphertext,
    scopes: owned.scopes,
  };
}

/** Stores a server-obtained refresh result; does not call Google or collect mail. */
export async function refreshGoogleConnectionTokens(
  userId: string,
  connectionId: string,
  tokens: Pick<GoogleConnectionCandidate, "accessToken" | "refreshToken" | "tokenExpiresAt"> & { expectedAccessTokenCiphertext: string },
): Promise<boolean> {
  const owned = await getOwnedConnection(userId, connectionId);
  if (!owned) return false;
  const accountId = owned.accountId;
  const key = getGoogleTokenEncryptionKey();
  const access = sealGoogleToken(tokens.accessToken, tokenContext(userId, accountId, "access"), key);
  const refresh = tokens.refreshToken === null ? null
    : sealGoogleToken(tokens.refreshToken, tokenContext(userId, accountId, "refresh"), key);
  // This snapshot must be captured BEFORE the outbound refresh, never at save time.
  const expected = tokens.expectedAccessTokenCiphertext;
  if (!expected) return false;
  const { data, error } = await createAdminClient().rpc("refresh_google_connection_tokens_guarded", {
    p_user_id: userId, p_connection_id: connectionId,
    p_access_token_ciphertext: access.ciphertext, p_access_token_iv: access.iv, p_access_token_tag: access.tag,
    p_refresh_token_ciphertext: refresh?.ciphertext ?? null,
    p_refresh_token_iv: refresh?.iv ?? null, p_refresh_token_tag: refresh?.tag ?? null,
    p_token_expires_at: tokens.tokenExpiresAt, p_encryption_version: access.version,
    p_expected_access_token_ciphertext: expected,
  });
  if (error) throw new Error("Unable to refresh stored Google credentials.");
  return data;
}

/** Scope upgrade uses a separate narrow RPC; it cannot create or reconnect an account. */
export async function persistGoogleScopeUpgrade(candidate: Omit<GoogleConnectionCandidate, "gmailHistoryId"> & {
  connectionId: string; expectedConnectionUpdatedAt: string; expectedAccessTokenCiphertext: string;
  purpose?: "drive_scope_upgrade" | "calendar_scope_upgrade";
}) {
  await verifyOwner(candidate.userId);
  const current = await getGoogleOAuthConnection(candidate.userId);
  if (!current || current.id !== candidate.connectionId || current.status !== "connected"
    || current.provider_account_id !== candidate.providerAccountId || current.updated_at !== candidate.expectedConnectionUpdatedAt)
    throw new GoogleConnectionStorageUnavailableError();
  const scopes = validateGrantedScopes(candidate.scopes.join(" "), candidate.purpose ?? "drive_scope_upgrade", current.scopes);
  const key = getGoogleTokenEncryptionKey();
  const access = sealGoogleToken(candidate.accessToken, tokenContext(candidate.userId, candidate.providerAccountId, "access"), key);
  // Callback always verifies a concrete refresh token before saving an upgrade.
  if (!candidate.refreshToken) throw new GoogleConnectionStorageUnavailableError();
  const refresh = sealGoogleToken(candidate.refreshToken, tokenContext(candidate.userId, candidate.providerAccountId, "refresh"), key);
  const { data, error } = await createAdminClient().rpc(candidate.purpose === "calendar_scope_upgrade" ? "upgrade_google_calendar_scopes" : "upgrade_google_connection_scopes", {
    p_user_id: candidate.userId, p_connection_id: candidate.connectionId,
    p_provider_account_id: candidate.providerAccountId, p_account_email: candidate.accountEmail, p_scopes: scopes,
    p_expected_connection_updated_at: candidate.expectedConnectionUpdatedAt,
    p_expected_access_token_ciphertext: candidate.expectedAccessTokenCiphertext,
    p_access_token_ciphertext: access.ciphertext, p_access_token_iv: access.iv, p_access_token_tag: access.tag,
    p_refresh_token_ciphertext: refresh.ciphertext, p_refresh_token_iv: refresh.iv, p_refresh_token_tag: refresh.tag,
    p_token_expires_at: candidate.tokenExpiresAt, p_encryption_version: access.version,
  });
  if (error || data !== candidate.connectionId) throw new GoogleConnectionStorageUnavailableError();
}

export async function disconnectGoogleConnection(connectionId: string): Promise<void> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("disconnect_google_connection", { p_connection_id: connectionId });
  if (error || !data) throw new Error("Unable to disconnect Google connection.");
}
