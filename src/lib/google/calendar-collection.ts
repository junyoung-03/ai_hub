import "server-only";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCalendarClient } from "@/lib/google/calendar-client";
import { htmlToText } from "@/lib/google/gmail-message";
import { CALENDAR_LIMITS, CalendarError, canonicalEvent, collectionWindow, parseEvent, record } from "@/lib/google/calendar-contract";
import type { CalendarCollectionResult } from "@/types/calendar";
import type { Json } from "@/types/database";

const active = new Set<string>();
export async function collectCalendar(): Promise<CalendarCollectionResult> {
  const startedAt = Date.now(), window = collectionWindow(startedAt);
  const user = await requireUser(), cookie = await createClient();
  const { data: connections, error } = await cookie.from("connections").select("id,status")
    .eq("user_id", user.id).eq("provider", "google").limit(2);
  if (error || connections?.length !== 1 || connections[0].status !== "connected") throw new CalendarError("CONNECTION_REQUIRED");
  const connectionId = connections[0].id, key = `${user.id}:${connectionId}`;
  if (active.has(key)) throw new CalendarError("GOOGLE_UNAVAILABLE");
  active.add(key);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, CALENDAR_LIMITS.runMs - (Date.now() - startedAt)));
  const result: CalendarCollectionResult = { created: 0, updated: 0, reused: 0, skipped: 0, failed: 0, unprocessed: 0,
    complete: false, capped: false, stopReason: null, pagesRead: 0, requestId: randomUUID() };
  let bytes = 0, count = 0, fresh = 0;
  try {
    const client = await createCalendarClient(user.id, connectionId), admin = createAdminClient();
    let pageToken: string | null = null; const pages = new Set<string>(), events = new Set<string>();
    do {
      let page;
      try {
        page = await client.list(window, pageToken, controller.signal); result.pagesRead++;
        if (page.nextPageToken && pages.has(page.nextPageToken)) throw new CalendarError("GOOGLE_UNAVAILABLE");
        if (page.nextPageToken) pages.add(page.nextPageToken);
      } catch {
        result.stopReason = controller.signal.aborted ? "RUN_TIMEOUT" : "LIST_FAILED";
        result.capped = controller.signal.aborted; break;
      }
      for (let index = 0; index < page.items.length; index++) {
        if (controller.signal.aborted || bytes >= CALENDAR_LIMITS.totalBytes) {
          result.stopReason = controller.signal.aborted ? "RUN_TIMEOUT" : "RUN_BYTES_LIMIT";
          result.capped = true; result.unprocessed += page.items.length - index; break;
        }
        count++;
        try {
          let event = parseEvent(page.items[index], page.calendarTimezone, htmlToText);
          if (!event || events.has(event.eventId)) { result.skipped++; continue; }
          events.add(event.eventId);
          const { data: existing, error: readError } = await cookie.from("items")
            .select("id,updated_at,source_updated_at,content_hash,metadata")
            .eq("user_id", user.id).eq("connection_id", connectionId).eq("source", "calendar")
            .eq("external_container_id", "primary").eq("external_id", event.eventId).abortSignal(controller.signal).maybeSingle();
          if (readError) throw new CalendarError("STORAGE_FAILED");
          if (event.status === "cancelled" && !existing) { result.skipped++; continue; }
          // Capture ITEM CAS BEFORE fresh HTTP, never after. No DB lock spans Google requests.
          const stored = record(record(existing?.metadata).calendar);
          if (existing && (event.status === "cancelled" || stored.status === "cancelled")) {
            if (fresh >= CALENDAR_LIMITS.fresh) throw new CalendarError("SOURCE_CHANGED");
            fresh++;
            event = parseEvent(await client.event(event.eventId, controller.signal), page.calendarTimezone, htmlToText);
            if (!event) throw new CalendarError("SOURCE_CHANGED");
          }
          const content = canonicalEvent(event);
          if (bytes + content.bytes > CALENDAR_LIMITS.totalBytes) {
            result.unprocessed += page.items.length - index; result.capped = true; result.stopReason = "RUN_BYTES_LIMIT"; break;
          }
          bytes += content.bytes;
          controller.signal.throwIfAborted();
          // Even reuse goes through RPC ownership/scope/active-connection checks; RPC does no UPDATE on reuse.
          const { data, error: saveError } = await admin.rpc("persist_calendar_item", {
            p_user_id: user.id, p_connection_id: connectionId, p_event_id: event.eventId,
            p_title: event.summary, p_original_url: event.htmlLink, p_content_text: content.text, p_content_hash: content.hash,
            p_source_created_at: event.created, p_source_updated_at: event.updated,
            p_calendar_metadata: event as unknown as Json, p_expected_item_updated_at: existing?.updated_at ?? null,
          }).abortSignal(controller.signal);
          if (saveError) throw new CalendarError(saveError.code === "40001" ? "SOURCE_CHANGED" : "STORAGE_FAILED");
          const saved = record(data);
          if (!["created", "updated", "reused", "skipped"].includes(String(saved.outcome))) throw new CalendarError("STORAGE_FAILED");
          result[saved.outcome as "created" | "updated" | "reused" | "skipped"]++;
        } catch { result.failed++; }
      }
      pageToken = page.nextPageToken;
      if (result.stopReason) break;
      if (controller.signal.aborted) { result.capped = true; result.stopReason = "RUN_TIMEOUT"; break; }
      if (pageToken && count >= CALENDAR_LIMITS.events) { result.capped = true; result.stopReason = "EVENT_LIMIT"; break; }
      if (pageToken && result.pagesRead >= CALENDAR_LIMITS.pages) { result.capped = true; result.stopReason = "PAGE_LIMIT"; break; }
    } while (pageToken);
    result.complete = !result.capped && !result.stopReason && result.failed === 0 && result.unprocessed === 0;
    return result;
  } finally { clearTimeout(timer); active.delete(key); }
}
