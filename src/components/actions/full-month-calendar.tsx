"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SearchActionResult } from "@/types/search-ui";
import { SourceBadge, WorkspaceSkeleton } from "@/components/workspace/workspace-ui";
import { ActionStateButton } from "@/components/items/write-controls";
import { actionDay, dDay, eventOnDay, monthCells, shortDate, type ScheduleEvent } from "./schedule-model";

// A display union retains independent Action and Event data contracts.
type Entry = { kind: "deadline"; action: SearchActionResult } | { kind: "event"; event: ScheduleEvent };
const entryTitle = (entry: Entry) => entry.kind === "deadline" ? entry.action.title : entry.event.title;
const entryId = (entry: Entry) => entry.kind === "deadline" ? `deadline:${entry.action.actionId}` : entry.event.id;
const entryKind = (entry: Entry) => entry.kind === "deadline" ? "마감" : entry.event.kind === "calendar" ? "일정" : "AI가 찾은 일정";
const entryStyle = (entry: Entry) => entry.kind === "deadline" ? "border-transparent bg-[#fff0e9] text-[#bf6746]" : entry.event.kind === "calendar" ? "border-transparent bg-[#eaf1fc] text-[#587fb5]" : "border-[#c4d6f0] bg-white text-[#6688ba]";
const entryTime = (entry: Entry) => {
  const value = entry.kind === "deadline" ? entry.action.deadlineAt : entry.event.time;
  return value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "";
};
function Marker({ entry }: { entry: Entry }) {
  return <span aria-hidden="true" className={`mt-0.5 inline-block size-1.5 shrink-0 ${entry.kind === "deadline" ? "rotate-45 bg-[#cb7958]" : entry.event.kind === "calendar" ? "rounded-full bg-[#638bbf]" : "rounded-sm border border-[#93b2df]"}`}/>;
}

export function FullMonthCalendar({ month, onMonth, today, actions, events, selected, onSelect, busy }: {
  month: string; onMonth: (value: string) => void; today: string;
  actions: SearchActionResult[]; events: ScheduleEvent[]; selected: string | null; onSelect: (value: string | null) => void; busy: boolean;
}) {
  const [chosen, setChosen] = useState<Entry | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const agendaDay = selected ?? (today.startsWith(month) ? today : `${month}-01`);
  const onDay = (date: string): Entry[] => [
    ...actions.filter(action => actionDay(action) === date).map(action => ({ kind: "deadline" as const, action })),
    ...events.filter(event => eventOnDay(event, date)).map(event => ({ kind: "event" as const, event })),
  ];
  const openEntry = (entry: Entry) => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setChosen(entry); };
  useEffect(() => { if (chosen && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [chosen]);
  const close = () => { dialog.current?.close(); setChosen(null); returnFocus.current?.focus(); };
  useEffect(() => {
    if (chosen?.kind !== "deadline") return;
    const changed = () => { dialog.current?.close(); setChosen(null); returnFocus.current?.focus(); };
    window.addEventListener("ai-hub:actions-changed", changed);
    return () => window.removeEventListener("ai-hub:actions-changed", changed);
  }, [chosen]);
  const move = (step: number) => {
    const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + step);
    onMonth(date.toISOString().slice(0, 7)); onSelect(null);
  };
  const agenda = onDay(agendaDay);
  return <section aria-label="월간 전체 캘린더" className="min-w-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><button onClick={() => move(-1)} aria-label="이전 달" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white"><ChevronLeft className="size-4"/></button><h2 className="min-w-28 text-center text-sm font-semibold text-slate-800">{month.slice(0, 4)}년 {Number(month.slice(5))}월</h2><button onClick={() => move(1)} aria-label="다음 달" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white"><ChevronRight className="size-4"/></button><button onClick={() => { onMonth(today.slice(0, 7)); onSelect(today); }} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-white">오늘</button></div>
      <div aria-label="캘린더 범례" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500"><span><span className="mr-1 text-[#cb7958]">◆</span>마감 · 이날까지</span><span><span className="mr-1 text-[#638bbf]">●</span>일정 · 이날 열림</span><span><span className="mr-1 text-[#93b2df]">□</span>AI가 찾은 일정</span></div>
    </div>
    {busy&&<WorkspaceSkeleton rows={1}/>}
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90">
      <div className="grid grid-cols-7 border-b border-slate-200/70 text-left text-[11px] text-slate-400">{["일", "월", "화", "수", "목", "금", "토"].map(day => <span key={day} className="px-2 py-2">{day}</span>)}</div>
      <div className="grid grid-cols-7">{monthCells(month).map(date => {
        const entries = onDay(date);
        const current = date.startsWith(month);
        return <div key={date} data-calendar-date={date} className={`min-w-0 border-b border-r border-slate-100 p-1.5 [&:nth-child(7n)]:border-r-0 md:min-h-28 md:p-2 ${current ? selected === date ? "bg-[#f3f7fe]" : "bg-white/70" : "bg-[#f8fafc]"}`}>
          <button onClick={() => onSelect(date)} aria-label={`${date} · ${entries.filter(entry => entry.kind === "deadline").length}건 마감 · ${entries.filter(entry => entry.kind === "event").length}건 일정`} aria-pressed={selected === date} className={`flex min-h-9 w-full flex-col items-center justify-center gap-1 rounded-lg text-xs md:min-h-6 md:w-6 md:rounded-full ${date === today ? "bg-[#7894bd] font-semibold text-white" : selected === date ? "bg-[#e6eefc] text-[#587fb5]" : current ? "text-slate-600 hover:bg-slate-50" : "text-slate-300"}`}><span>{Number(date.slice(8))}</span><span className="flex h-1.5 items-center gap-1 md:hidden">{entries.slice(0, 3).map(entry => <Marker key={entryId(entry)} entry={entry}/>)}{entries.length > 3 && <span className="text-[9px]">+</span>}</span></button>
          <div className="mt-1.5 hidden space-y-1 md:block">{entries.slice(0, 3).map(entry => <button key={entryId(entry)} onClick={() => openEntry(entry)} aria-label={`${entryKind(entry)} · ${entryTitle(entry)}${entryTime(entry) ? ` · ${entryTime(entry)}` : ""}`} title={entryTitle(entry)} className={`flex w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[11px] leading-4 ${entryStyle(entry)} ${entry.kind === "deadline" && entry.action.status === "completed" ? "opacity-60" : ""}`}><Marker entry={entry}/><span className="min-w-0 flex-1 truncate">{entryTitle(entry)}</span>{entryTime(entry) && <span className="hidden shrink-0 text-[9px] lg:inline">{entryTime(entry)}</span>}</button>)}{entries.length > 3 && <button onClick={() => onSelect(date)} aria-label={`${date} 항목 ${entries.length}개 모두 보기`} className="px-1.5 text-[10px] text-slate-400 hover:text-[#587fb5]">+{entries.length - 3}개</button>}</div>
        </div>;
      })}</div>
    </div>
    <section aria-label="선택 날짜 Agenda" className={`mt-5 ${selected ? "" : "md:hidden"}`}>
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-700">{shortDate(agendaDay)} <span className="ml-1 font-normal text-slate-400">{agenda.length}건</span></h3>{selected && <button aria-label="날짜 선택 해제" onClick={() => onSelect(null)} className="text-xs text-slate-400 hover:text-[#587fb5]">선택 해제</button>}</div>
      <div className="space-y-2">{agenda.map(entry => <button key={entryId(entry)} onClick={() => openEntry(entry)} className="flex w-full min-w-0 items-start gap-3 rounded-xl border border-slate-200/70 bg-white/90 p-4 text-left"><span className={`mt-0.5 rounded-md border px-2 py-1 text-[10px] ${entryStyle(entry)}`}>{entryKind(entry)}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-slate-700">{entryTitle(entry)}</span><span className="mt-1 block text-xs text-slate-400">{entry.kind === "deadline" ? dDay(entry.action, today) : entryTime(entry) || "날짜 일정"}</span></span></button>)}</div>
      {!busy&&!agenda.length && <p className="rounded-xl border border-slate-200/60 bg-white/65 p-5 text-sm text-slate-400">이 날짜에 확인된 마감이나 일정이 없습니다.</p>}
    </section>
    <dialog ref={dialog} aria-labelledby="calendar-entry-title" onCancel={() => { setChosen(null); returnFocus.current?.focus(); }} onClose={() => setChosen(null)} onClick={event => { if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-700 shadow-xl backdrop:bg-slate-900/20 sm:p-6">
      {chosen && <CalendarEntryDetail entry={chosen} today={today} close={close}/>}
    </dialog>
  </section>;
}

function CalendarEntryDetail({ entry, today, close }: { entry: Entry; today: string; close: () => void }) {
  const date = entry.kind === "deadline" ? actionDay(entry.action) : entry.event.date;
  const sources = entry.kind === "deadline" ? entry.action.sources : [{ itemId: entry.event.itemId, title: entry.event.title, source: entry.event.source, text: entry.event.evidence }];
  return <>
    <div className="mb-4 flex items-start justify-between gap-3"><span className={`rounded-md border px-2 py-1 text-[11px] ${entryStyle(entry)}`}>{entryKind(entry)}</span><button onClick={close} aria-label="항목 상세 닫기" className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"><X className="size-4"/></button></div>
    <h3 id="calendar-entry-title" className="break-words text-lg font-semibold text-slate-800">{entryTitle(entry)}</h3>
    <p className="mt-2 text-sm text-slate-500">{shortDate(date)}{entry.kind === "event" && entry.event.lastDate !== date ? ` ~ ${shortDate(entry.event.lastDate)}` : ""}{entryTime(entry) ? ` · ${entryTime(entry)}` : ""}{entry.kind === "deadline" ? ` · ${dDay(entry.action, today)}` : entry.event.tentative ? " · 미확정" : ""}</p>
    <div className="mt-4 space-y-3">{sources.map((source, index) => <div key={`${source.itemId}:${index}`} className="rounded-xl bg-[#f7f9fc] p-3"><SourceBadge source={source.source}/>{source.text && <blockquote className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-500">“{source.text}”</blockquote>}<Link href={`/items/${source.itemId}`} className="mt-2 inline-block break-words text-xs text-[#6484b3] hover:underline">자료 보기 · {source.title} ↗</Link></div>)}</div>
    {!sources.length && <p className="mt-4 text-sm text-slate-400">연결된 원문 근거가 없습니다.</p>}
    {entry.kind === "deadline" && <div className="mt-4"><ActionStateButton actionId={entry.action.actionId} status={entry.action.status}/></div>}
  </>;
}
