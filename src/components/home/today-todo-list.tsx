"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { SearchActionResult } from "@/types/search-ui";
import { actionDay, shortDate, type ScheduleEvent } from "@/components/actions/schedule-model";

function clock(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function TodayTodoList({ today, actions, events, eventEnds, busy, error, scheduleError }: {
  today: string;
  actions: SearchActionResult[];
  events: ScheduleEvent[];
  eventEnds: Record<string, string>;
  busy: boolean;
  error: string;
  scheduleError: string;
}) {
  const todayActions = actions.filter(action => actionDay(action) === today && action.status === "open");
  const upcoming = events.filter(event => event.date > today).slice(0, 5);

  return (
    <aside aria-label="오늘 할 일 및 다가오는 일정" className="home-agenda flex flex-col gap-4">
      <section className="home-agenda-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">오늘 할 일</h2>
          <span className="whitespace-nowrap text-[13px] text-slate-500">{shortDate(today)}</span>
        </div>
        {error && <p role="alert" className="py-3 text-sm text-red-600">{error}</p>}
        {busy ? <p role="status" className="py-5 text-sm text-slate-500">할 일을 불러오는 중…</p> : (
          <ul className="divide-y divide-blue-50 border-t border-blue-50">
            {todayActions.map(action => (
              <li key={action.actionId} className="flex min-h-[48px] items-center gap-3 py-3">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${action.sources.length ? "bg-red-500" : "bg-blue-600"}`} />
                <Link href="/actions" className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 hover:text-blue-600" title={action.title}>{action.title}</Link>
                <span className="shrink-0 text-sm tabular-nums text-slate-500">{clock(action.deadlineAt) || "시간 미정"}</span>
              </li>
            ))}
            {!todayActions.length && !error && <li className="py-8 text-sm text-slate-500">오늘 할 일이 없습니다.</li>}
          </ul>
        )}
      </section>
      <section className="home-agenda-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">다가오는 일정</h2>
          <Link href="/actions" className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-blue-600 hover:underline">전체 보기 <ArrowRight className="size-3.5" /></Link>
        </div>
        {scheduleError && <p role="alert" className="py-3 text-sm text-red-600">{scheduleError}</p>}
        {busy ? <p role="status" className="py-5 text-sm text-slate-500">일정을 불러오는 중…</p> : (
          <ul className="divide-y divide-blue-50">
            {upcoming.map(event => (
              <li key={event.id} className="flex items-center gap-3 py-2.5">
                <time dateTime={event.date} className="grid w-12 shrink-0 rounded-xl bg-slate-50 py-1 text-center text-[13px] font-medium leading-5 text-slate-700">
                  <span>{event.date.slice(5).replace("-", ". ")}</span>
                  <span className="text-xs text-slate-500">({new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(`${event.date}T00:00:00+09:00`))})</span>
                </time>
                <span aria-hidden="true" className={`mb-5 size-2 shrink-0 rounded-full ${event.kind === "calendar" ? "bg-blue-600" : "bg-purple-600"}`} />
                <div className="min-w-0">
                  <Link href={`/items/${event.itemId}`} className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-600" title={event.title}>{event.title}</Link>
                  <p className="text-[13px] tabular-nums text-slate-500">{clock(event.time) ? `${clock(event.time)}${clock(eventEnds[event.id]) ? ` - ${clock(eventEnds[event.id])}` : ""}` : event.kind === "calendar" ? "종일" : "시간 미정"}</p>
                </div>
              </li>
            ))}
            {!upcoming.length && !scheduleError && <li className="py-8 text-sm text-slate-500">다가오는 일정이 없습니다.</li>}
          </ul>
        )}
      </section>
    </aside>
  );
}
