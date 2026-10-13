"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck, Plus } from "lucide-react";
import { PageHeading } from "@/components/shell/page-heading";
import { AddTodoModal } from "@/components/home/add-todo-modal";
import { ActionStateButton } from "@/components/items/write-controls";
import { ActionMenu } from "./action-menu";
import { WorkspaceSkeleton } from "@/components/workspace/workspace-ui";
import { useActions } from "./use-workspace-data";
import { actionDay, dayInSeoul, shortDate } from "./schedule-model";
import { matchesPlannerFilter, plannerGroup, plannerSections, type PlannerFilter } from "./planner-model";

const filters: { key: PlannerFilter; label: string }[] = [
  { key: "all", label: "전체" }, { key: "today", label: "오늘" },
  { key: "week", label: "이번 주" }, { key: "upcoming", label: "예정" }, { key: "completed", label: "완료" },
];

export function PlannerWorkspace({ today: initialToday, now: initialNow }: { today: string; now: number }) {
  const [now, setNow] = useState(initialNow);
  const today = dayInSeoul(now) || initialToday;
  const [filter, setFilter] = useState<PlannerFilter>("all");
  const [adding, setAdding] = useState(false);
  const open = useActions("open"), completed = useActions("completed");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const relevant = filter === "completed" ? [completed] : filter === "all" ? [open, completed] : [open];
  const busy = relevant.some(data => data.busy);
  const error = relevant.find(data => data.error)?.error;
  const rows = [...open.rows, ...completed.rows].filter(action => matchesPlannerFilter(action, filter, today))
    .sort((a, b) => (actionDay(a) || "9999").localeCompare(actionDay(b) || "9999") || (a.deadlineAt || "").localeCompare(b.deadlineAt || "") || a.actionId.localeCompare(b.actionId));

  return <div>
    <PageHeading title="플래너" description="해야 할 일과 마감 일정을 관리하세요."><button className="workspace-primary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true"/>할 일 추가</button></PageHeading>
    <div role="group" aria-label="할 일 필터" className="mb-7 flex flex-wrap gap-2">{filters.map(entry => <button key={entry.key} aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)} className={`min-h-10 rounded-xl border px-5 text-sm transition-colors ${filter === entry.key ? "border-blue-200 bg-blue-50 font-semibold text-blue-600" : "border-slate-200/70 bg-white/90 text-slate-500 hover:bg-white"}`}>{entry.label}</button>)}</div>
    {busy && <WorkspaceSkeleton rows={4}/>}
    {error && <div role="alert" className="workspace-card mb-5 p-5 text-sm text-red-600">{error}<button onClick={() => relevant.forEach(data => data.reload())} className="ml-3 underline">다시 불러오기</button></div>}
    {!busy && <div className="space-y-7">{plannerSections.map(section => {
      const tasks = rows.filter(action => plannerGroup(action, today, now) === section.key);
      if (!tasks.length) return null;
      return <section key={section.key} aria-label={section.label}>
        <h2 className={`mb-3 flex items-center gap-2 font-semibold ${section.key === "overdue" ? "text-red-600" : "text-slate-800"}`}>{section.label}<span className="text-xs font-normal text-slate-400">{tasks.length}</span></h2>
        <ul className="workspace-card divide-y divide-slate-100">{tasks.map(action => {
          const date = actionDay(action), source = action.sources[0], done = action.status === "completed";
          const time = action.deadlineAt ? new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(new Date(action.deadlineAt)) : null;
          return <li key={action.actionId} className="flex flex-wrap items-center gap-3 px-5 py-5 sm:flex-nowrap sm:px-6">
            <span className={`size-2 shrink-0 rounded-full ${done ? "bg-slate-300" : section.key === "overdue" ? "bg-red-500" : action.type === "check" ? "bg-amber-500" : "bg-blue-600"}`} aria-hidden="true"/>
            <div className="min-w-0 flex-1"><h3 className={`text-sm font-semibold leading-6 ${done ? "text-slate-400 line-through" : "text-slate-800"}`}>{source ? <Link href={`/items/${source.itemId}`} className="hover:text-blue-600">{action.title}</Link> : action.title}</h3><div className="mt-1 text-xs text-slate-500">{source ? <Link href={`/items/${source.itemId}`} className="hover:text-blue-600">근거 · {source.title}</Link> : "연결된 자료 없음"}{action.deadlineStatus === "needs_review" && <span className="ml-2 text-amber-700">마감일 확인 필요</span>}</div></div>
            <div className="ml-5 flex w-full items-center justify-between gap-4 sm:ml-0 sm:w-auto"><div className="min-w-24 text-right text-sm tabular-nums text-slate-500">{date ? <time dateTime={action.deadlineAt ?? date}>{date === today ? time ?? "오늘 · 시간 미정" : shortDate(date)}{date !== today && time && <span className="mt-1 block text-xs">{time}</span>}</time> : "날짜 미정"}</div><ActionStateButton actionId={action.actionId} status={action.status}/><ActionMenu action={action}/></div>
          </li>;
        })}</ul>
      </section>;
    })}
    {!rows.length && !error && <div className="workspace-card px-6 py-16 text-center"><CheckCheck className="mx-auto mb-4 size-7 text-slate-300" aria-hidden="true"/><h2 className="font-semibold text-slate-800">{filter === "completed" ? "완료한 할 일이 없습니다." : "표시할 할 일이 없습니다."}</h2><p className="mt-2 text-sm text-slate-500">{filter === "completed" ? "할 일을 완료하면 여기에 모아볼 수 있습니다." : "새 할 일을 추가하거나 다른 필터를 확인해보세요."}</p>{filter !== "completed" && <button onClick={() => setAdding(true)} className="mt-5 text-sm font-medium text-blue-600">+ 할 일 추가</button>}</div>}
    </div>}
    <AddTodoModal key={today} isOpen={adding} onClose={() => setAdding(false)} initialDate={today} onAdded={() => { open.reload(); }}/>
  </div>;
}
