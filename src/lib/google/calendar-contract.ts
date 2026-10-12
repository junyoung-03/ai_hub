import { createHash } from "node:crypto";
import type { CalendarDate, CalendarDetail, CalendarEvent, CalendarFailureCode } from "@/types/calendar";

export const CALENDAR_LIMITS = Object.freeze({ events: 200, pageSize: 50, pages: 4, requestMs: 10_000,
  runMs: 120_000, codePoints: 100_000, bytes: 400_000, totalBytes: 2_000_000, fresh: 20 });
export class CalendarError extends Error {
  constructor(public readonly code: CalendarFailureCode) { super(code); }
}
export const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const isEventId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,1024}$/.test(v);
export function timestamp(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
    && Number.isFinite(Date.parse(v)) && validDate(v.slice(0, 10));
}
function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export function timezone(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; }
}
export function calendarDate(v: unknown): CalendarDate | null {
  const r = record(v);
  if (r.timeZone !== undefined && !timezone(r.timeZone)) return null;
  const tz = typeof r.timeZone === "string" ? { timeZone: r.timeZone } : {};
  if (validDate(r.date) && r.dateTime === undefined) return { date: r.date, ...tz };
  if (timestamp(r.dateTime) && r.date === undefined) return { dateTime: r.dateTime, ...tz };
  return null;
}
export function calendarUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !u.port
      && ((u.hostname === "www.google.com" && u.pathname.startsWith("/calendar/"))
        || u.hostname === "calendar.google.com") ? u.href : null;
  } catch { return null; }
}
export function collectionWindow(startedAt: number) {
  const day = 86_400_000;
  return { timeMin: new Date(startedAt - 30 * day).toISOString(), timeMax: new Date(startedAt + 90 * day).toISOString() };
}
export function parseEvent(raw: unknown, calendarTimezone: string, htmlToText: (html: string) => string): CalendarEvent | null {
  const v = record(raw);
  if (!isEventId(v.id) || !timezone(calendarTimezone)) throw new CalendarError("INVALID_EVENT");
  if (v.eventType !== undefined && v.eventType !== "default") return null;
  if (v.recurrence !== undefined) return null; // master is never an ITEM
  if (!["confirmed", "tentative", "cancelled"].includes(String(v.status))) throw new CalendarError("INVALID_EVENT");
  const cancelled = v.status === "cancelled", start = calendarDate(v.start), end = calendarDate(v.end);
  if (!cancelled && (!start || !end || (("date" in start) !== ("date" in end))
    || ("date" in start && "date" in end ? end.date < start.date
      : "dateTime" in start && "dateTime" in end && Date.parse(end.dateTime) < Date.parse(start.dateTime))))
    throw new CalendarError("INVALID_EVENT");
  const original = v.originalStartTime === undefined ? null : calendarDate(v.originalStartTime);
  if ((v.recurringEventId !== undefined && (!isEventId(v.recurringEventId) || !original))
    || (v.originalStartTime !== undefined && (!original || !isEventId(v.recurringEventId)))) throw new CalendarError("INVALID_EVENT");
  for (const key of ["created", "updated"] as const)
    if (v[key] !== undefined && !timestamp(v[key])) throw new CalendarError("INVALID_EVENT");
  if (v.etag !== undefined && (typeof v.etag !== "string" || !v.etag || v.etag.length > 1024)) throw new CalendarError("INVALID_EVENT");
  if (v.endTimeUnspecified !== undefined && typeof v.endTimeUnspecified !== "boolean") throw new CalendarError("INVALID_EVENT");
  const text = (key: string) => {
    if (v[key] === undefined) return "";
    if (typeof v[key] !== "string") throw new CalendarError("INVALID_EVENT");
    if (Buffer.byteLength(v[key]) > CALENDAR_LIMITS.bytes) throw new CalendarError("EVENT_LIMIT");
    return v[key].replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  };
  return { eventId: v.id, calendarId: "primary", etag: typeof v.etag === "string" ? v.etag : null,
    updated: timestamp(v.updated) ? v.updated : null, created: timestamp(v.created) ? v.created : null,
    status: v.status as CalendarEvent["status"], eventType: "default", summary: text("summary"),
    description: htmlToText(text("description")), location: text("location"), htmlLink: calendarUrl(v.htmlLink),
    start, end, allDay: start ? "date" in start : null,
    eventTimezone: start?.timeZone ?? end?.timeZone ?? null, calendarTimezone,
    endTimeUnspecified: v.endTimeUnspecified === true,
    recurringEventId: isEventId(v.recurringEventId) ? v.recurringEventId : null, originalStartTime: original,
    extractionVersion: "calendar-text-v1" };
}
export function canonicalEvent(event: CalendarEvent) {
  const date = (v: CalendarDate | null) => v ? ("date" in v ? v.date : v.dateTime) + (v.timeZone ? ` [${v.timeZone}]` : "") : "";
  const text = [event.summary, event.description, event.location, `Event start: ${date(event.start)}`,
    `Event end (exclusive): ${date(event.end)}`, `Calendar timezone: ${event.calendarTimezone}`].join("\n\n");
  if (Array.from(text).length > CALENDAR_LIMITS.codePoints || Buffer.byteLength(text) > CALENDAR_LIMITS.bytes)
    throw new CalendarError("EVENT_LIMIT");
  return { text, hash: createHash("sha256").update(text, "utf8").digest("hex"), bytes: Buffer.byteLength(text) };
}
/** Rebuild from whitelisted fields, never spread raw metadata into Detail. */
export function calendarDetail(metadata: unknown): CalendarDetail | null {
  const r = record(record(metadata).calendar);
  if (r.calendarId !== "primary" || r.extractionVersion !== "calendar-text-v1"
    || r.eventType !== "default" || !["confirmed", "tentative", "cancelled"].includes(String(r.status))
    || !timezone(r.calendarTimezone)) return null;
  const start = calendarDate(r.start), end = calendarDate(r.end);
  if (r.status !== "cancelled" && (!start || !end)) return null;
  return { status: r.status as CalendarDetail["status"], eventType: "default", start, end,
    allDay: start ? "date" in start : null, eventTimezone: timezone(r.eventTimezone) ? r.eventTimezone : null,
    calendarTimezone: r.calendarTimezone, endTimeUnspecified: r.endTimeUnspecified === true,
    location: typeof r.location === "string" ? r.location : "",
    recurringEventId: isEventId(r.recurringEventId) ? r.recurringEventId : null,
    originalStartTime: calendarDate(r.originalStartTime) };
}
