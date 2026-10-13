"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import type { SearchActionResult } from "@/types/search-ui";
import { SourceBadge } from "@/components/workspace/workspace-ui";
import {
  actionDay,
  dDay,
  eventOnDay,
  monthCells,
  shortDate,
  shiftDay,
  type ScheduleEvent,
} from "@/components/actions/schedule-model";

type Entry =
  | { kind: "deadline"; action: SearchActionResult }
  | { kind: "event"; event: ScheduleEvent };

const entryTitle = (entry: Entry) =>
  entry.kind === "deadline" ? entry.action.title : entry.event.title;
const entryId = (entry: Entry) =>
  entry.kind === "deadline" ? `deadline:${entry.action.actionId}` : entry.event.id;
const entryKind = (entry: Entry) =>
  entry.kind === "deadline"
    ? "마감"
    : entry.event.kind === "calendar"
    ? "Google 일정"
    : "AI 일정";

const entryTime = (entry: Entry) => {
  const value = entry.kind === "deadline" ? entry.action.deadlineAt : entry.event.time;
  return value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "";
};

// Section 21: Limited color usage - Small dots only, NO background color cards
const entryDotClass = (entry: Entry) => {
  if (entry.kind === "deadline") {
    if (entry.action.status === "completed") return "bg-slate-300";
    if (entry.action.sources.length === 0 || entry.action.sources.some((s) => s.source === "manual")) {
      return "bg-emerald-600"; // 직접 추가 Todo: green dot (#16A34A)
    }
    return "bg-red-500"; // 마감: red dot (#EF4444)
  }
  // kind === "event"
  if (entry.event.kind === "calendar") {
    return "bg-blue-600"; // Google/일반 일정: blue dot (#2563EB)
  }
  return "bg-purple-600"; // AI가 찾은 Event: purple dot (#7C3AED)
};

export function TodayCalendar({
  today,
  actions,
  events,
  busy,
  onAddAction,
}: {
  today: string;
  actions: SearchActionResult[];
  events: ScheduleEvent[];
  busy: boolean;
  onAddAction?: (date: string) => void;
}) {
  void busy;
  const [currentMonth, setCurrentMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [viewMode, setViewMode] = useState<"month" | "week" | "day">("month");
  const [chosen, setChosen] = useState<Entry | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const onDay = (date: string): Entry[] => [
    ...actions
      .filter((action) => actionDay(action) === date)
      .map((action) => ({ kind: "deadline" as const, action })),
    ...events
      .filter((event) => eventOnDay(event, date))
      .map((event) => ({ kind: "event" as const, event })),
  ];

  const moveMonth = (step: number) => {
    if (viewMode !== "month") {
      const date = shiftDay(selectedDate || today, step * (viewMode === "week" ? 7 : 1));
      setSelectedDate(date);
      setCurrentMonth(date.slice(0, 7));
      return;
    }
    const date = new Date(`${currentMonth}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    setCurrentMonth(date.toISOString().slice(0, 7));
  };

  const openEntry = (entry: Entry) => {
    setChosen(entry);
  };

  const closeDialog = () => {
    dialog.current?.close();
    setChosen(null);
  };

  useEffect(() => {
    if (chosen && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
    }
  }, [chosen]);

  // Selected date entries
  const selectedEntries = selectedDate ? onDay(selectedDate) : [];

  // Helper for week cells around selectedDate or today
  const getWeekDays = (baseDate: string) => {
    const d = new Date(`${baseDate}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    const monday = new Date(d.getTime() - day * 86400000);
    return Array.from({ length: 7 }, (_, i) => {
      const target = new Date(monday.getTime() + i * 86400000);
      return target.toISOString().slice(0, 10);
    });
  };

  const weekDays = getWeekDays(selectedDate || today);

  return (
    <section aria-label="오늘 캘린더" className="home-calendar rounded-2xl border border-white/80 bg-white/95 p-5 shadow-[0_4px_24px_#2563eb04]">
      {/* 캘린더 상단 헤더: Section 11: 2026년 10월  < >  오늘        + 할 일 추가 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* 년월 + 이전/다음/오늘 */}
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            {currentMonth.slice(0, 4)}년 {Number(currentMonth.slice(5))}월
          </h2>
          <div className="flex items-center gap-0.5 ml-1">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              aria-label={viewMode === "month" ? "이전 달" : viewMode === "week" ? "이전 주" : "이전 날"}
              className="grid size-8 place-items-center rounded-lg border border-slate-100 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              aria-label={viewMode === "month" ? "다음 달" : viewMode === "week" ? "다음 주" : "다음 날"}
              className="grid size-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentMonth(today.slice(0, 7));
                setSelectedDate(today);
              }}
              className="ml-1 rounded-lg border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              오늘
            </button>
          </div>
        </div>

        {/* 뷰 전환 (일간, 주간, 월간) + [ + 할 일 추가 ] 버튼 */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center rounded-lg bg-slate-100/80 p-0.5 text-xs">
            {(
              [
                ["day", "일간"],
                ["week", "주간"],
                ["month", "월간"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`rounded-lg px-3.5 py-2 font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-blue-50 text-blue-600 ring-1 ring-blue-100"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Unified + 할 일 추가 Entrypoint */}
          {onAddAction && (
            <button
              type="button"
              onClick={() => onAddAction(selectedDate || today)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 shadow-xs transition-colors"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              할 일 추가
            </button>
          )}
        </div>
      </div>

      {/* 캘린더 본체: Section 10 & 20 - Large height, text-first typography, NO color cards */}
      {viewMode === "month" && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50 text-center text-xs font-medium text-slate-400">
            {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
              <div key={day} className="py-2.5">
                {day}
              </div>
            ))}
          </div>

          {/* 월간 그리드 (높이 확장 min-h-[104px], 텍스트 중심 일정) */}
          <div className="grid grid-cols-7">
            {monthCells(currentMonth).map((date) => {
              const entries = onDay(date);
              const isCurrentMonth = date.startsWith(currentMonth);
              const isToday = date === today;
              const isSelected = selectedDate === date;
              const dayNum = Number(date.slice(8));

              return (
                <div
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`home-calendar-cell group relative min-h-[96px] border-b border-r border-slate-100 p-2 transition-colors [&:nth-child(7n)]:border-r-0 cursor-pointer ${
                    isSelected
                      ? "bg-blue-50/40 ring-1 ring-inset ring-blue-300"
                      : isCurrentMonth
                      ? "bg-white hover:bg-slate-50/60"
                      : "bg-slate-50/30 hover:bg-slate-50/70"
                  }`}
                >
                  {/* 날짜 숫자 & 호버 시 간편 + 버튼 */}
                  <div className="flex items-center justify-between mb-1.5">
                    <button
                      type="button"
                      aria-label={`${date} 선택`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDate(date)}
                      className={`grid size-7 place-items-center rounded-full text-xs transition-colors ${
                        isToday
                          ? "bg-blue-600 font-bold text-white shadow-xs"
                          : isSelected
                          ? "font-semibold text-blue-700 bg-blue-100/70"
                          : isCurrentMonth
                          ? "text-slate-700"
                          : "text-slate-300"
                      }`}
                    >
                      {dayNum}
                    </button>
                  </div>

                  {/* 일정 텍스트 목록 (컬러 박스 없음, 텍스트 중심) */}
                  <div className="space-y-1">
                    {entries.slice(0, 3).map((entry) => {
                      const title = entryTitle(entry);
                      const dotClass = entryDotClass(entry);
                      const isCompleted = entry.kind === "deadline" && entry.action.status === "completed";

                      return (
                        <button
                          key={entryId(entry)}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEntry(entry);
                          }}
                          className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-[13px] leading-tight hover:bg-slate-100/90 transition-colors"
                        >
                          <span className={`size-1.5 shrink-0 rounded-full ${dotClass} mt-1`} />
                          <span
                            className={`truncate ${
                              isCompleted
                                ? "text-slate-400 line-through"
                                : "text-slate-800 font-medium"
                            }`}
                          >
                            {title}
                          </span>
                        </button>
                      );
                    })}

                    {entries.length > 3 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDate(date);
                          setViewMode("day");
                        }}
                        className="w-full text-left px-1 text-[10px] font-medium text-slate-400 hover:text-blue-600"
                      >
                        +{entries.length - 3}개 더
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 주간 뷰 (Weekly) */}
      {viewMode === "week" && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50 text-center text-xs font-medium text-slate-400">
            {["월", "화", "수", "목", "금", "토", "일"].map((day, idx) => {
              const date = weekDays[idx];
              const isToday = date === today;
              return (
                <div key={day} className="py-2.5">
                  <span>{day}</span>
                  <div
                    className={`mt-1 mx-auto grid size-6 place-items-center rounded-full text-xs ${
                      isToday ? "bg-blue-600 font-bold text-white" : "text-slate-700"
                    }`}
                  >
                    {date.slice(8)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-7 divide-x divide-slate-100 min-h-[340px]">
            {weekDays.map((date) => {
              const entries = onDay(date);
              return (
                <div key={date} className="p-2 space-y-1.5 bg-white">
                  {entries.map((entry) => {
                    const dotClass = entryDotClass(entry);
                    const isCompleted = entry.kind === "deadline" && entry.action.status === "completed";
                    return (
                      <button
                        key={entryId(entry)}
                        type="button"
                        onClick={() => openEntry(entry)}
                        className="w-full text-left rounded-lg p-1.5 border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`size-1.5 rounded-full ${dotClass}`} />
                        </div>
                        <div
                          className={`text-xs ${
                            isCompleted ? "text-slate-400 line-through" : "text-slate-700"
                          } truncate`}
                        >
                          {entryTitle(entry)}
                        </div>
                      </button>
                    );
                  })}
                  {entries.length === 0 && (
                    <div className="text-center pt-8 text-[11px] text-slate-300">일정 없음</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 일간 뷰 (Daily) */}
      {viewMode === "day" && (
        <div className="rounded-xl border border-slate-200/80 p-4 bg-white min-h-[340px]">
          <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-sm font-semibold text-slate-800">
              {shortDate(selectedDate || today)} 일정
            </h3>
            <span className="text-xs text-slate-400">총 {selectedEntries.length}건</span>
          </div>
          {selectedEntries.length > 0 ? (
            <ul className="space-y-2">
              {selectedEntries.map((entry) => {
                const dotClass = entryDotClass(entry);
                const isCompleted = entry.kind === "deadline" && entry.action.status === "completed";
                return (
                  <li
                    key={entryId(entry)}
                    onClick={() => openEntry(entry)}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`size-2 rounded-full ${dotClass}`} />
                      <span
                        className={`text-sm truncate ${
                          isCompleted ? "text-slate-400 line-through" : "text-slate-800 font-medium"
                        }`}
                      >
                        {entryTitle(entry)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-center py-12 text-sm text-slate-400">
              선택한 날짜에 등록된 일정이 없습니다.
            </p>
          )}
        </div>
      )}

      {/* 일정 상세 모달 */}
      <dialog
        ref={dialog}
        aria-labelledby="calendar-entry-title"
        onCancel={closeDialog}
        onClose={closeDialog}
        onClick={(event) => {
          if (event.target === dialog.current) closeDialog();
        }}
        className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-700 shadow-xl backdrop:bg-slate-900/20 sm:p-6"
      >
        {chosen && (
          <div>
            <div className="mb-4 flex items-start justify-between gap-3">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                {entryKind(chosen)}
              </span>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="항목 상세 닫기"
                className="grid size-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="size-4" />
              </button>
            </div>

            <h3 id="calendar-entry-title" className="text-lg font-semibold text-slate-900">
              {entryTitle(chosen)}
            </h3>

            <p className="mt-2 text-sm text-slate-500">
              {shortDate(
                chosen.kind === "deadline" ? actionDay(chosen.action) : chosen.event.date
              )}
              {entryTime(chosen) ? ` · ${entryTime(chosen)}` : ""}
              {chosen.kind === "deadline" ? ` · ${dDay(chosen.action, today)}` : ""}
            </p>

            <div className="mt-5 space-y-3">
              {(chosen.kind === "deadline"
                ? chosen.action.sources
                : [
                    {
                      itemId: chosen.event.itemId,
                      title: chosen.event.title,
                      source: chosen.event.source,
                      text: chosen.event.evidence,
                    },
                  ]
              ).map((src, index) => (
                <div key={index} className="rounded-xl bg-slate-50 p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1.5">
                    <SourceBadge source={src.source} />
                    <span className="text-slate-400">{src.title}</span>
                  </div>
                  {src.text && (
                    <blockquote className="text-slate-600 whitespace-pre-wrap leading-relaxed">
                      “{src.text}”
                    </blockquote>
                  )}
                  <Link
                    href={`/items/${src.itemId}`}
                    className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
                  >
                    원문 자료 확인하기 ↗
                  </Link>
                </div>
              ))}
            </div>

            {chosen.kind === "deadline" && (
              <div className="mt-5 border-t border-slate-100 pt-4 flex justify-end">
                <Link href="/actions" className="text-sm font-medium text-blue-600 hover:underline">할 일 관리하기 →</Link>
              </div>
            )}
          </div>
        )}
      </dialog>
    </section>
  );
}
