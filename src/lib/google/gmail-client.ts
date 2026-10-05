import "server-only";

import { getGoogleConnectionTokens, refreshGoogleConnectionTokens } from "@/lib/google/connections";
import { refreshGoogleAccessToken } from "@/lib/google/data-oauth";
import { record } from "@/lib/google/gmail-message";

export const INITIAL_GMAIL_QUERY = "in:inbox newer_than:30d";
export const INITIAL_GMAIL_LIMIT = 100;
export class GmailCollectionError extends Error {
  constructor(public readonly code: "CONNECTION_REQUIRED" | "TOKEN_MISSING" | "REFRESH_FAILED" | "GMAIL_UNAVAILABLE" | "SYNC_IN_PROGRESS" | "STORAGE_FAILED") {
    super(code);
  }
}

/** The token is closed over by server-only callers, never returned to a route. */
export async function createGmailClient(userId: string, connectionId: string) {
  const saved = await getGoogleConnectionTokens(userId, connectionId);
  if (!saved) throw new GmailCollectionError("TOKEN_MISSING");
  let accessToken = saved.accessToken, refreshToken = saved.refreshToken, expiresAt = saved.expiresAt;
  let expectedAccessTokenCiphertext = saved.accessTokenCiphertext;
  const requiredScopes = saved.scopes;
  let refreshing: Promise<void> | null = null;
  async function refresh() {
    if (!refreshing) refreshing = (async () => {
      try {
        if (!refreshToken) throw new Error("Missing refresh credentials.");
        const next = await refreshGoogleAccessToken(refreshToken, requiredScopes);
        if (!await refreshGoogleConnectionTokens(userId, connectionId, { ...next, expectedAccessTokenCiphertext })) throw new Error("Connection no longer active.");
        const stored = await getGoogleConnectionTokens(userId, connectionId);
        if (!stored || stored.accessToken !== next.accessToken) throw new Error("Credentials changed concurrently.");
        expectedAccessTokenCiphertext = stored.accessTokenCiphertext;
        accessToken = next.accessToken;
        refreshToken = next.refreshToken ?? refreshToken;
        expiresAt = next.tokenExpiresAt;
      } catch { throw new GmailCollectionError("REFRESH_FAILED"); }
    })().finally(() => { refreshing = null; });
    await refreshing;
  }
  async function get(path: string, params: Record<string, string> = {}) {
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now() + 60_000) await refresh();
    async function send() {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
      url.search = new URLSearchParams(params).toString();
      try {
        return await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
        });
      } catch { throw new GmailCollectionError("GMAIL_UNAVAILABLE"); }
    }
    const sentToken = accessToken;
    let response = await send();
    if (response.status === 401) {
      // Another concurrent request may already have replaced this token.
      if (sentToken === accessToken) await refresh();
      response = await send();
    }
    if (!response.ok) throw new GmailCollectionError("GMAIL_UNAVAILABLE");
    try { return record(await response.json()); }
    catch { throw new GmailCollectionError("GMAIL_UNAVAILABLE"); }
  }
  return {
    async profile() {
      const payload = await get("profile", { fields: "historyId" });
      if (typeof payload.historyId !== "string" || !/^\d{1,20}$/.test(payload.historyId)) throw new GmailCollectionError("GMAIL_UNAVAILABLE");
      return payload.historyId;
    },
    async list() {
      const ids: string[] = [], seenPages = new Set<string>();
      let pageToken = "";
      let capped = false;
      do {
        const payload = await get("messages", {
          q: INITIAL_GMAIL_QUERY, maxResults: String(INITIAL_GMAIL_LIMIT - ids.length),
          fields: "messages(id),nextPageToken", ...(pageToken ? { pageToken } : {}),
        });
        for (const message of Array.isArray(payload.messages) ? payload.messages : []) {
          const id = record(message).id;
          if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(id)) throw new GmailCollectionError("GMAIL_UNAVAILABLE");
          if (!ids.includes(id) && ids.length < INITIAL_GMAIL_LIMIT) ids.push(id);
        }
        pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
        capped = Boolean(pageToken);
        if (pageToken && seenPages.has(pageToken)) throw new GmailCollectionError("GMAIL_UNAVAILABLE");
        seenPages.add(pageToken);
      } while (pageToken && ids.length < INITIAL_GMAIL_LIMIT);
      return { ids, capped };
    },
    async message(id: string) {
      if (!/^[A-Za-z0-9_-]{1,255}$/.test(id)) throw new GmailCollectionError("GMAIL_UNAVAILABLE");
      return get(`messages/${encodeURIComponent(id)}`, { format: "full", fields: "id,threadId,labelIds,snippet,historyId,internalDate,payload" });
    },
  };
}
