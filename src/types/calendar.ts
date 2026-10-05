export type CalendarDate = { date: string; timeZone?: string } | { dateTime: string; timeZone?: string };
export type CalendarEvent = {
  eventId: string; calendarId: "primary"; etag: string | null;
  updated: string | null; created: string | null;
  status: "confirmed" | "tentative" | "cancelled"; eventType: "default";
  summary: string; description: string; location: string; htmlLink: string | null;
  start: CalendarDate | null; end: CalendarDate | null; allDay: boolean | null;
  eventTimezone: string | null; calendarTimezone: string;
  endTimeUnspecified: boolean; recurringEventId: string | null; originalStartTime: CalendarDate | null;
  extractionVersion: "calendar-text-v1";
};
/** Original Calendar data, independent of AI eventObservations and Action deadlines. */
export type CalendarDetail = Pick<CalendarEvent, "status" | "eventType" | "start" | "end" | "allDay"
  | "eventTimezone" | "calendarTimezone" | "endTimeUnspecified" | "location" | "recurringEventId" | "originalStartTime">;
export type CalendarFailureCode = "CONNECTION_REQUIRED" | "CALENDAR_CONSENT_REQUIRED" | "REFRESH_FAILED"
  | "GOOGLE_UNAVAILABLE" | "ACCESS_UNAVAILABLE" | "INVALID_EVENT" | "EVENT_LIMIT" | "SOURCE_CHANGED" | "STORAGE_FAILED";
export type CalendarCollectionResult = {
  created: number; updated: number; reused: number; skipped: number; failed: number; unprocessed: number;
  complete: boolean; capped: boolean;
  stopReason: "EVENT_LIMIT" | "PAGE_LIMIT" | "RUN_BYTES_LIMIT" | "RUN_TIMEOUT" | "LIST_FAILED" | null;
  pagesRead: number; requestId: string;
};
