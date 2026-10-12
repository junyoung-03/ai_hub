import "server-only";
import { getGoogleConnectionTokens, getGoogleOAuthConnection, refreshGoogleConnectionTokens } from "@/lib/google/connections";
import { DRIVE_DOCS_SCOPES, refreshGoogleAccessToken } from "@/lib/google/data-oauth";
import { DriveError, DRIVE_LIMITS, isGoogleFileId, object } from "@/lib/google/drive-contract";
import type { DriveFile } from "@/types/drive";

export const DRIVE_FILE_FIELDS = "id,name,mimeType,webViewLink,createdTime,modifiedTime,parents,trashed,driveId";
function metadata(raw: unknown, expectedId?: string): DriveFile {
  const v = object(raw);
  if (!isGoogleFileId(v.id) || (expectedId && v.id !== expectedId) || typeof v.name !== "string" || typeof v.mimeType !== "string"
    || typeof v.trashed !== "boolean" || (v.parents !== undefined && (!Array.isArray(v.parents) || !v.parents.every(isGoogleFileId))))
    throw new DriveError("GOOGLE_UNAVAILABLE");
  return { id: v.id, name: v.name, mimeType: v.mimeType, parents: Array.isArray(v.parents) ? v.parents : [], trashed: v.trashed,
    ...(typeof v.webViewLink === "string" ? { webViewLink: v.webViewLink } : {}),
    ...(typeof v.createdTime === "string" ? { createdTime: v.createdTime } : {}),
    ...(typeof v.modifiedTime === "string" ? { modifiedTime: v.modifiedTime } : {}),
    ...(typeof v.driveId === "string" ? { driveId: v.driveId } : {}) };
}
async function boundedJson(response: Response, signal: AbortSignal) {
  // Transport guard includes JSON/style overhead; this is separate from the text quota.
  const limit = 8_000_000, chunks: Uint8Array[] = []; let size = 0;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel(); throw new DriveError("DOCUMENT_LIMIT");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DriveError("GOOGLE_UNAVAILABLE");
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DriveError("DOCUMENT_LIMIT"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof DriveError) throw error;
    throw new DriveError("GOOGLE_UNAVAILABLE");
  } finally { reader.releaseLock(); }
}
export async function createDriveClient(userId: string, connectionId: string) {
  let saved = await getGoogleConnectionTokens(userId, connectionId);
  if (!saved) throw new DriveError("CONNECTION_REQUIRED");
  if (!DRIVE_DOCS_SCOPES.every(scope => saved!.scopes.includes(scope))) throw new DriveError("DRIVE_CONSENT_REQUIRED");
  let refreshing: Promise<void> | null = null;
  async function refresh() {
    if (!refreshing) refreshing = (async () => {
      try {
        if (!saved) throw new Error();
        const next = await refreshGoogleAccessToken(saved.refreshToken, saved.scopes, false);
        if (!await refreshGoogleConnectionTokens(userId, connectionId, { ...next, expectedAccessTokenCiphertext: saved.accessTokenCiphertext })) throw new Error();
        const stored = await getGoogleConnectionTokens(userId, connectionId);
        if (!stored || stored.accessToken !== next.accessToken) throw new Error();
        saved = stored;
      } catch { throw new DriveError("REFRESH_FAILED"); }
    })().finally(() => { refreshing = null; });
    await refreshing;
  }
  async function get(url: URL, signal: AbortSignal) {
    if (!saved) throw new DriveError("CONNECTION_REQUIRED");
    signal.throwIfAborted();
    if (Date.parse(saved.expiresAt) <= Date.now() + 60_000 || !Number.isFinite(Date.parse(saved.expiresAt))) await refresh();
    let retry = 0, authRetried = false;
    for (;;) {
      const current = await getGoogleOAuthConnection(userId);
      if (!current || current.id !== connectionId || current.status !== "connected") throw new DriveError("CONNECTION_REQUIRED");
      if (!DRIVE_DOCS_SCOPES.every(scope => current.scopes?.includes(scope))) throw new DriveError("DRIVE_CONSENT_REQUIRED");
      signal.throwIfAborted();
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(DRIVE_LIMITS.requestMs)]);
      try {
        const sentToken = saved!.accessToken;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${sentToken}`, Accept: "application/json" },
          cache: "no-store", redirect: "error", signal: requestSignal });
        if (response.status === 401 && !authRetried) {
          authRetried = true;
          await response.body?.cancel();
          await refresh();
          continue;
        }
        if (response.status === 401) { await response.body?.cancel(); throw new DriveError("ACCESS_UNAVAILABLE"); }
        if ((response.status === 429 || response.status >= 500) && retry++ === 0) {
          // Do not keep a request alive for an unbounded provider Retry-After.
          const raw = response.headers.get("retry-after");
          const wait = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 0;
          await response.body?.cancel();
          if (Number.isFinite(wait) && wait > 1000) throw new DriveError("GOOGLE_UNAVAILABLE");
          if (wait > 0) await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, wait);
            function abort() { clearTimeout(timer); reject(new DriveError("GOOGLE_UNAVAILABLE")); }
            signal.addEventListener("abort", abort, { once: true });
          });
          continue;
        }
        if (response.status === 403 || response.status === 404) { await response.body?.cancel(); throw new DriveError("ACCESS_UNAVAILABLE"); }
        if (!response.ok) { await response.body?.cancel(); throw new DriveError("GOOGLE_UNAVAILABLE"); }
        return await boundedJson(response, requestSignal);
      } catch (error) {
        if (error instanceof DriveError) throw error;
        throw new DriveError("GOOGLE_UNAVAILABLE");
      }
    }
  }
  return {
    async file(id: string, signal: AbortSignal) {
      if (!isGoogleFileId(id)) throw new DriveError("GOOGLE_UNAVAILABLE");
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
      url.search = new URLSearchParams({ fields: DRIVE_FILE_FIELDS, supportsAllDrives: "false" }).toString();
      return metadata(await get(url, signal), id);
    },
    async children(folderId: string, pageToken: string | null, signal: AbortSignal) {
      if (!isGoogleFileId(folderId)) throw new DriveError("GOOGLE_UNAVAILABLE");
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.search = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'`,
        fields: `nextPageToken,incompleteSearch,files(${DRIVE_FILE_FIELDS})`, spaces: "drive", corpora: "user",
        supportsAllDrives: "false", includeItemsFromAllDrives: "false", pageSize: String(DRIVE_LIMITS.pageSize),
        orderBy: "name_natural", ...(pageToken ? { pageToken } : {}) }).toString();
      const raw = object(await get(url, signal));
      if (!Array.isArray(raw.files) || raw.files.length > DRIVE_LIMITS.pageSize || raw.incompleteSearch === true
        || (raw.nextPageToken !== undefined && (typeof raw.nextPageToken !== "string" || raw.nextPageToken.length > 4096)))
        throw new DriveError("GOOGLE_UNAVAILABLE");
      return { files: raw.files.map(v => metadata(v)), nextPageToken: typeof raw.nextPageToken === "string" ? raw.nextPageToken : null };
    },
    async document(id: string, signal: AbortSignal) {
      if (!isGoogleFileId(id)) throw new DriveError("GOOGLE_UNAVAILABLE");
      const url = new URL(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`);
      url.search = new URLSearchParams({ includeTabsContent: "true", suggestionsViewMode: "PREVIEW_WITHOUT_SUGGESTIONS",
        fields: "documentId,tabs" }).toString();
      const raw = await get(url, signal);
      if (object(raw).documentId !== id) throw new DriveError("GOOGLE_UNAVAILABLE");
      return raw;
    },
  };
}
