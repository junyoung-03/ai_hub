import type { ItemScheduleDetail } from "@/types/items";
import type { SearchActionResult } from "@/types/search-ui";

export type ScheduleEvent = {
  id: string; itemId: string; title: string; source: string;
  kind: "calendar" | "observation"; date: string; lastDate: string;
  time: string | null; evidence: string; tentative: boolean; inferredYear?: boolean;
};
export type UnresolvedScheduleEvent = {
  id: string; itemId: string; title: string; source: string; rawText: string; evidence: string;
};

/** Undated observations remain visible without assigning a calendar day. */
export function unresolvedEventsFromDetail(detail: ItemScheduleDetail): UnresolvedScheduleEvent[] {
  return detail.eventObservations.flatMap((event, index) => event.status === "needs_review" ? [{
    id: `observation:${detail.item.id}:${index}`, itemId: detail.item.id, title: detail.item.title,
    source: detail.item.source, rawText: event.rawText, evidence: event.evidence.text,
  }] : []);
}
export const dayInSeoul = (value: number | string) => {
  const time = typeof value === "string" ? Date.parse(value) : value;
  return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : "";
};
export const shiftDay = (date: string, count: number) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
export function weekEnd(today: string) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return shiftDay(today, 6 - (weekday + 6) % 7);
}
export function actionDay(action: SearchActionResult) {
  return action.deadlineStatus !== "confirmed" ? "" : action.deadlineAt ? dayInSeoul(action.deadlineAt) : action.deadlineDate ?? "";
}
export function isOverdue(action: SearchActionResult, today: string, now: number) {
  if (action.status === "completed" || !actionDay(action)) return false;
  return action.deadlineAt ? Date.parse(action.deadlineAt) < now : actionDay(action) < today;
}
export function dDay(action: SearchActionResult, today: string) {
  if (action.status === "completed") return "완료";
  const date = actionDay(action);
  if (!date) return action.deadlineStatus === "needs_review" ? "날짜 확인" : "날짜 미정";
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  return diff === 0 ? "D-day" : diff < 0 ? `D+${-diff}` : `D-${diff}`;
}
export function actionGroup(action: SearchActionResult, today: string, now: number) {
  const date = actionDay(action);
  if (!date) return "review";
  if (isOverdue(action, today, now)) return "overdue";
  if (date <= weekEnd(today)) return "week";
  if (date <= shiftDay(weekEnd(today), 7)) return "next";
  return "later";
}
export function eventGroup(event: ScheduleEvent, today: string) {
  if (event.lastDate < today) return "past";
  if (event.date <= weekEnd(today)) return "week";
  if (event.date <= shiftDay(weekEnd(today), 7)) return "next";
  return "later";
}
export function eventOnDay(event: ScheduleEvent, date: string) {
  return event.date <= date && date <= event.lastDate;
}
export function eventsFromDetail(detail: ItemScheduleDetail): ScheduleEvent[] {
  const { item, calendar, eventObservations } = detail;
  const events: ScheduleEvent[] = [];
  if (calendar?.start && calendar.status !== "cancelled") {
    const date = "date" in calendar.start ? calendar.start.date : dayInSeoul(calendar.start.dateTime);
    const end = calendar.end;
    // Google all-day end dates are exclusive. Exact timed ends are exclusive too.
    const lastDate = !end ? date : "date" in end ? shiftDay(end.date, -1) : dayInSeoul(Date.parse(end.dateTime) - 1);
    if (date) events.push({ id: `calendar:${item.id}`, itemId: item.id, title: item.title, source: item.source,
      kind: "calendar", date, lastDate: lastDate < date ? date : lastDate,
      time: "dateTime" in calendar.start ? calendar.start.dateTime : null,
      evidence: item.contentText?.slice(0, 220) ?? "", tentative: calendar.status === "tentative" });
  }
  for (const [index, event] of eventObservations.entries()) {
    if (event.status !== "confirmed" || !event.date) continue;
    const date = event.datetime ? dayInSeoul(event.datetime) : event.date;
    // Preserve independent observations; never create or merge an Action from a date.
    events.push({ id: `observation:${item.id}:${index}`, itemId: item.id, title: item.title, source: item.source,
      kind: "observation", date, lastDate: date, time: event.datetime,
      evidence: event.evidence.text, tentative: false, inferredYear: !/\d{4}/.test(event.evidence.text) });
  }
  return events;
}
export function shortDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {month:"numeric",day:"numeric",weekday:"short",timeZone:"Asia/Seoul"}).format(new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value));
}
export function monthCells(month: string) {
  const first = `${month}-01`;
  const start = shiftDay(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const count = Math.ceil((new Date(`${first}T00:00:00Z`).getUTCDay() + days) / 7) * 7;
  return Array.from({length:count}, (_, index) => shiftDay(start, index));
}
