import Link from "next/link";
import { SourceBadge } from "@/components/workspace/workspace-ui";
import type { UnresolvedScheduleEvent } from "./schedule-model";

export function UnresolvedEvents({ events }: { events: UnresolvedScheduleEvent[] }) {
  if (!events.length) return null;
  return <section aria-label="날짜 확인이 필요한 AI 일정" className="mt-5 rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4 sm:p-5">
    <h2 className="text-sm font-semibold text-slate-800">날짜 확인이 필요한 AI 일정 <span className="ml-1 text-xs font-normal">{events.length}건</span></h2>
    <p className="mt-2 text-xs leading-6 text-slate-500">일정은 찾았지만 연도나 날짜가 불명확해 달력의 특정 날짜에는 표시하지 않았어요. 원문을 확인해 주세요.</p>
    <ul className="mt-3 space-y-3">{events.map(event => <li key={event.id} className="rounded-xl border border-amber-200/50 bg-white/90 p-3">
      <div className="flex flex-wrap items-center gap-2"><SourceBadge source={event.source}/><span className="text-xs text-amber-800">AI 일정 · 날짜 확인 필요</span></div>
      <Link href={`/items/${event.itemId}`} className="mt-2 block break-words text-sm font-semibold text-slate-700 hover:underline">{event.title}</Link>
      <blockquote className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-slate-500">“{event.evidence}”</blockquote>
      <p className="mt-1 text-xs text-slate-500">원문 날짜: {event.rawText}</p>
    </li>)}</ul>
  </section>;
}
