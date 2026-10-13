import type { SearchActionResult } from "@/types/search-ui";
import { actionDay, type ScheduleEvent } from "@/components/actions/schedule-model";

export type UpcomingEntry = {
  id: string; title: string; date: string; time: string | null;
  kind: "deadline" | "calendar" | "observation"; href: string;
};

/** Read the same Actions and Events as Calendar without converting either model. */
export function upcomingEntries(today: string, actions: SearchActionResult[], events: ScheduleEvent[]): UpcomingEntry[] {
  const rows: UpcomingEntry[] = [
    ...actions.filter(action => action.status === "open" && actionDay(action) > today).map(action => ({
      id: `deadline:${action.actionId}`, title: action.title, date: actionDay(action), time: action.deadlineAt,
      kind: "deadline" as const, href: "/actions",
    })),
    ...events.filter(event => event.date > today).map(event => ({
      id: event.id, title: event.title, date: event.date, time: event.time, kind: event.kind, href: `/items/${event.itemId}`,
    })),
  ];
  const time = (row: UpcomingEntry) => row.time && Number.isFinite(Date.parse(row.time)) ? Date.parse(row.time) : Infinity;
  return [...new Map(rows.map(row => [row.id, row])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || time(a) - time(b) || a.id.localeCompare(b.id)).slice(0, 5);
}
