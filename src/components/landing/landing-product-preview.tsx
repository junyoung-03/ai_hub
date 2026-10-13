"use client";

import { ArrowRight, Search } from "lucide-react";
import { TodayCalendar } from "@/components/home/today-calendar";
import { TodayTodoList } from "@/components/home/today-todo-list";
import type { SearchActionResult } from "@/types/search-ui";
import type { ScheduleEvent } from "@/components/actions/schedule-model";

const today = "2026-10-13";
const actions: SearchActionResult[] = [
  { id: "proposal", title: "제안서 최종 확인", day: "13", time: "15:00" },
  { id: "meeting-notes", title: "회의록 정리", day: "13", time: "17:00" },
  { id: "report", title: "프로젝트 보고서 제출", day: "16", time: "14:00" },
  { id: "contract", title: "계약 관련 문서 검토", day: "20", time: "10:00" },
].map(({id,title,day,time}) => ({kind:"action",actionId:`sample-${id}`,title,type:"required",status:"open",deadlineStatus:"confirmed",deadlineDate:`2026-10-${day}`,deadlineAt:`2026-10-${day}T${time}:00+09:00`,requirements:[],conditions:[],sources:[]}));
const events: ScheduleEvent[] = [
  { id:"sample-team-meeting",itemId:"sample-meeting",title:"프로젝트 미팅",source:"calendar",kind:"calendar",date:"2026-10-14",lastDate:"2026-10-14",time:"2026-10-14T10:00:00+09:00",evidence:"서비스 소개용 샘플",tentative:false },
  { id:"sample-seminar",itemId:"sample-document",title:"새로운 서비스 설명회",source:"upload",kind:"observation",date:"2026-10-22",lastDate:"2026-10-22",time:null,evidence:"서비스 소개용 샘플",tentative:false },
];

/** Public read-only preview uses real Home components and synthetic data only. */
export function LandingProductPreview() {
  return <figure>
    <div className="overflow-hidden rounded-2xl border border-white bg-white/50 p-2 shadow-[0_20px_60px_-30px_rgba(37,99,235,0.25)] sm:rounded-3xl sm:p-3">
      <div inert aria-hidden="true" className="rounded-xl bg-blue-50/60 p-3 sm:rounded-2xl sm:p-5">
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-blue-100/70 pb-3"><span className="flex items-center gap-1 text-lg font-bold"><span className="text-2xl text-blue-600">✦</span>etc.</span><div className="flex gap-1 text-[11px] font-medium sm:gap-2 sm:text-xs">{["오늘","자료함","플래너","설정"].map((label,index) => <span key={label} className={`rounded-lg px-2 py-1.5 sm:px-3 ${index === 0 ? "bg-white text-blue-600" : "text-slate-500"}`}>{label}</span>)}</div><span className="hidden text-xs text-slate-500 sm:block">나의 워크스페이스</span></div>
        <div className="mb-5"><p className="text-2xl font-bold tracking-tight">오늘</p><p className="mt-1 text-xs text-slate-500">내 일정과 해야 할 일을 한눈에 확인하세요.</p><div className="mt-4 flex items-center gap-3 rounded-2xl border border-blue-100 bg-white px-4 py-3"><Search className="size-4 text-slate-400"/><span className="flex-1 text-xs text-slate-400 sm:text-sm">자료, 일정, 할 일 등 무엇이든 물어보세요...</span><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-white"><ArrowRight className="size-4"/></span></div><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">{["이번 주 할 일","계약","오늘 할 일","회의"].map(label => <span key={label} className="rounded-full border border-blue-100/70 bg-white px-3 py-1">{label}</span>)}</div></div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3.7fr)_minmax(245px,1fr)]">
          <div className="hidden min-w-0 sm:block"><TodayCalendar today={today} actions={actions} events={events} busy={false} onAddAction={() => undefined}/></div>
          <TodayTodoList today={today} actions={actions} events={events} eventEnds={{"sample-team-meeting":"2026-10-14T12:00:00+09:00"}} busy={false} error="" scheduleError=""/>
        </div>
      </div>
    </div>
    <figcaption className="mt-4 text-center text-xs leading-6 text-slate-500">현재 Home 구성에 샘플 자료를 넣은 화면입니다. 로그인 후에는 내 자료와 할 일이 표시됩니다.</figcaption>
  </figure>;
}
