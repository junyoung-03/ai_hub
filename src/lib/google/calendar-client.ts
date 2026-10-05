import "server-only";
import { getGoogleConnectionTokens, getGoogleOAuthConnection, refreshGoogleConnectionTokens } from "@/lib/google/connections";
import { CALENDAR_SCOPE, refreshGoogleAccessToken } from "@/lib/google/data-oauth";
import { CALENDAR_LIMITS, CalendarError, isEventId, record, timezone } from "@/lib/google/calendar-contract";

export const CALENDAR_EVENT_FIELDS = "id,etag,created,updated,status,eventType,summary,description,location,htmlLink,start,end,endTimeUnspecified,recurringEventId,originalStartTime,recurrence";
async function boundedJson(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new CalendarError("GOOGLE_UNAVAILABLE");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8_000_000) { await reader.cancel(); throw new CalendarError("EVENT_LIMIT"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}
export async function createCalendarClient(userId: string, connectionId: string) {
  let saved = await getGoogleConnectionTokens(userId, connectionId);
  if (!saved) throw new CalendarError("CONNECTION_REQUIRED");
  if (!saved.scopes.includes(CALENDAR_SCOPE)) throw new CalendarError("CALENDAR_CONSENT_REQUIRED");
  async function get(url: URL, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!saved) throw new CalendarError("CONNECTION_REQUIRED");
    if (!Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) <= Date.now() + 60_000) {
      try {
        const next = await refreshGoogleAccessToken(saved.refreshToken, saved.scopes, true);
        signal.throwIfAborted();
        if (!await refreshGoogleConnectionTokens(userId, connectionId, { ...next, expectedAccessTokenCiphertext: saved.accessTokenCiphertext })) throw new Error();
        saved = await getGoogleConnectionTokens(userId, connectionId);
        if (!saved || saved.accessToken !== next.accessToken || !saved.scopes.includes(CALENDAR_SCOPE)) throw new Error();
      } catch { throw new CalendarError("REFRESH_FAILED"); }
    }
    for (let attempt = 0; ; attempt++) {
      const connection = await getGoogleOAuthConnection(userId);
      if (!connection || connection.id !== connectionId || connection.status !== "connected") throw new CalendarError("CONNECTION_REQUIRED");
      if (!connection.scopes?.includes(CALENDAR_SCOPE)) throw new CalendarError("CALENDAR_CONSENT_REQUIRED");
      signal.throwIfAborted();
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(CALENDAR_LIMITS.requestMs)]);
      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${saved!.accessToken}`, Accept: "application/json" },
          cache: "no-store", redirect: "error", signal: requestSignal });
        // Parse only to classify an allowlisted reason; never surface raw provider errors.
        let rateLimited = response.status === 429;
        if (response.status === 403) {
          const raw = record(await boundedJson(response, requestSignal));
          const errors = record(raw.error).errors;
          rateLimited = Array.isArray(errors) && errors.length > 0 && errors.every(e => record(e).reason === "rateLimitExceeded");
        }
        if ((rateLimited || response.status >= 500) && attempt === 0) {
          const raw = response.headers.get("retry-after");
          const wait = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 250 + Math.floor(Math.random() * 250);
          if (!response.bodyUsed) await response.body?.cancel();
          if (!Number.isFinite(wait) || wait > 1000) throw new CalendarError("GOOGLE_UNAVAILABLE");
          if (wait > 0) await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new CalendarError("GOOGLE_UNAVAILABLE")); };
            const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, wait);
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          });
          continue;
        }
        if (!response.ok) {
          if (!response.bodyUsed) await response.body?.cancel();
          throw new CalendarError(rateLimited ? "GOOGLE_UNAVAILABLE" : response.status === 403 || response.status === 404 ? "ACCESS_UNAVAILABLE" : "GOOGLE_UNAVAILABLE");
        }
        return await boundedJson(response, requestSignal);
      } catch (error) { if (error instanceof CalendarError) throw error; throw new CalendarError("GOOGLE_UNAVAILABLE"); }
    }
  }
  return {
    async list(window: { timeMin: string; timeMax: string }, pageToken: string | null, signal: AbortSignal) {
      const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      url.search = new URLSearchParams({ singleEvents: "true", showDeleted: "true", eventTypes: "default",
        timeMin: window.timeMin, timeMax: window.timeMax, maxResults: String(CALENDAR_LIMITS.pageSize),
        fields: `timeZone,nextPageToken,items(${CALENDAR_EVENT_FIELDS})`, ...(pageToken ? { pageToken } : {}) }).toString();
      const raw = record(await get(url, signal));
      if (!timezone(raw.timeZone) || !Array.isArray(raw.items) || raw.items.length > CALENDAR_LIMITS.pageSize
        || (raw.nextPageToken !== undefined && (typeof raw.nextPageToken !== "string" || !raw.nextPageToken || raw.nextPageToken.length > 4096)))
        throw new CalendarError("GOOGLE_UNAVAILABLE");
      return { items: raw.items as unknown[], calendarTimezone: raw.timeZone,
        nextPageToken: typeof raw.nextPageToken === "string" ? raw.nextPageToken : null };
    },
    async event(id: string, signal: AbortSignal) {
      if (!isEventId(id)) throw new CalendarError("INVALID_EVENT");
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`);
      url.searchParams.set("fields", CALENDAR_EVENT_FIELDS);
      const raw = await get(url, signal);
      if (record(raw).id !== id) throw new CalendarError("INVALID_EVENT");
      return raw;
    },
  };
}
