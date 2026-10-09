"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Circle, X } from "lucide-react";
import type { SearchActionResult } from "@/types/search-ui";
import { ActionStateButton } from "@/components/items/write-controls";
import { SourceBadge, WorkspaceSkeleton } from "@/components/workspace/workspace-ui";
import { useActions, useScheduleItems } from "./use-workspace-data";
import { FullMonthCalendar } from "./full-month-calendar";
import { actionDay, actionGroup, dayInSeoul, dDay, eventGroup, eventOnDay, eventsFromDetail, isOverdue, monthCells, shortDate, weekEnd, type ScheduleEvent } from "./schedule-model";

function ActionRow({action,today,now,compact=false}:{action:SearchActionResult;today:string;now:number;compact?:boolean}) {
  const date=actionDay(action), overdue=isOverdue(action,today,now);
  const remaining=date ? (Date.parse(date)-Date.parse(today))/86400000 : null;
  const urgent=!overdue && remaining!==null && remaining<=3 && action.status!=="completed";
  const status=action.status==="completed"?"완료":overdue?"기한 지남":!date?"확인 필요":urgent?"임박":"예정";
  const color=overdue?"bg-red-50 text-red-600":urgent?"bg-orange-50 text-orange-600":action.status==="completed"?"bg-emerald-50 text-emerald-700":"bg-slate-50 text-slate-500";
  const lead=action.sources[0];
  return <article className="min-w-0 rounded-2xl border border-slate-200/70 bg-white/90 p-4 transition-colors hover:border-[#b8c9e4] sm:p-5">
    <div className="flex items-start gap-3">
      {compact ? <span className={`mt-0.5 inline-flex min-w-14 shrink-0 justify-center rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${color}`}>{dDay(action,today)}</span> : <Circle className={`mt-1 size-4 shrink-0 ${action.status==="completed"?"text-emerald-500":"text-slate-300"}`} aria-hidden="true"/>}
      <div className="min-w-0 flex-1">
        <h3 className={`break-words text-[14px] font-semibold leading-6 ${action.status==="completed"?"text-slate-400 line-through":"text-slate-800"}`}>{lead?<Link href={`/items/${lead.itemId}`} className="hover:text-[#5f7fae]">{action.title}</Link>:action.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{[...new Set(action.sources.map(source=>source.source))].map(source=><SourceBadge key={source} source={source}/>)}<span className="min-w-0 truncate text-[11px] text-slate-400">{action.type==="required"?"해야 할 일":action.type==="optional"?"신청·선택":"조건 확인"}</span></div>
        {lead && <blockquote className="mt-3 line-clamp-2 rounded-lg bg-[#f7f9fc] px-3 py-2 text-xs leading-5 text-slate-500">“{lead.text}”</blockquote>}
        {!lead && <p className="mt-2 text-xs text-slate-400">연결된 원문 근거를 확인해 주세요.</p>}
        {!compact&&<div className="mt-2 flex flex-wrap items-center justify-between gap-2">{lead&&<Link href={`/items/${lead.itemId}`} className="text-[11px] text-[#6d88b0] hover:underline">근거 · 원문 확인 ↗</Link>}<ActionStateButton actionId={action.actionId} status={action.status}/></div>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {!compact&&<span className={`rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${color}`}>{dDay(action,today)}</span>}
        {date&&<time dateTime={action.deadlineAt??date} className="text-[11px] text-slate-400">{shortDate(action.deadlineAt??date)}</time>}
        {!compact&&<span className={`rounded-md px-2 py-0.5 text-[10px] ${color}`}>{status}</span>}
      </div>
    </div>
  </article>;
}
function EventRow({event}:{event:ScheduleEvent}) {
  return <Link href={`/items/${event.itemId}`} className="block min-w-0 rounded-2xl border border-slate-200/70 bg-white/85 p-4 transition-colors hover:border-[#b8c9e4]">
    <div className="flex gap-3"><span className={`mt-1 size-2 shrink-0 rounded-full ${event.kind==="observation"?"border border-[#9bb3d5]":"bg-[#6c8cb9]"}`} aria-hidden="true"/>
      <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold leading-6 text-slate-800">{event.title}</h3><div className="mt-1 flex flex-wrap items-center gap-2"><SourceBadge source={event.source}/><span className="text-[11px] text-slate-400">{event.kind==="calendar"?"Calendar 일정":"AI가 찾은 일정"}{event.tentative?" · 미확정":""}</span></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{event.evidence}</p></div>
      <time dateTime={event.time??event.date} className="shrink-0 text-[11px] text-[#6d88b0]">{shortDate(event.time??event.date)}</time>
    </div>
  </Link>;
}
function MonthCalendar({month,onMonth,today,actions,events,selected,onSelect}:{month:string;onMonth:(value:string)=>void;today:string;actions:SearchActionResult[];events:ScheduleEvent[];selected:string|null;onSelect:(value:string|null)=>void}) {
  const move=(step:number)=>{const date=new Date(`${month}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+step);onMonth(date.toISOString().slice(0,7));onSelect(null);};
  return <section aria-label="월간 캘린더" className="rounded-2xl border border-slate-200/70 bg-white/90 p-5">
    <div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-800">{month.slice(0,4)}년 {Number(month.slice(5))}월</h2><div className="flex gap-1"><button onClick={()=>move(-1)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50" aria-label="이전 달"><ChevronLeft className="size-4"/></button><button onClick={()=>{onMonth(today.slice(0,7));onSelect(today);}} className="rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-50">오늘</button><button onClick={()=>move(1)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50" aria-label="다음 달"><ChevronRight className="size-4"/></button></div></div>
    <div className="grid grid-cols-7 text-center text-[11px] text-slate-400">{["일","월","화","수","목","금","토"].map(day=><span key={day} className="pb-2">{day}</span>)}</div>
    <div className="grid grid-cols-7 gap-y-1">{monthCells(month).map(date=>{
      const deadlines=actions.filter(action=>action.status!=="completed"&&actionDay(action)===date).length;
      const calendar=events.filter(event=>event.kind==="calendar"&&eventOnDay(event,date)).length;
      const observation=events.filter(event=>event.kind==="observation"&&eventOnDay(event,date)).length;
      return <button key={date} aria-pressed={selected===date} aria-label={`${date} · 마감 ${deadlines}건 · 일정 ${calendar}건 · AI 일정 ${observation}건`} onClick={()=>onSelect(selected===date?null:date)} className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl text-xs ${selected===date?"bg-[#6b88b3] text-white":date===today?"bg-[#eef3fb] font-semibold text-[#5b79a5]":date.startsWith(month)?"text-slate-600 hover:bg-slate-50":"text-slate-300"}`}><span>{Number(date.slice(8))}</span><span className="flex h-1.5 gap-1" aria-hidden="true">{!!deadlines&&<span className="size-1.5 rotate-45 bg-orange-500"/>}{!!calendar&&<span className="size-1.5 rounded-full bg-[#6086bd]"/>}{!!observation&&<span className="size-1.5 rounded-full border border-[#9eb9df]"/>}</span></button>;
    })}</div>
    <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-[11px] text-slate-400"><p className="flex items-center gap-2"><span className="size-1.5 rotate-45 bg-orange-500"/>마감 <span>· 확정된 할 일의 기한</span></p><p className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#6086bd]"/>일정 <span>· Calendar 행사·회의</span></p><p className="flex items-center gap-2"><span className="size-1.5 rounded-full border border-[#9eb9df]"/>AI 일정 <span>· 자료에서 확인된 날짜</span></p></div>
  </section>;
}
export function ScheduleWorkspace({today:initialToday,now:initialNow,home=false}:{today:string;now:number;home?:boolean}) {
  const [now,setNow]=useState(initialNow), [status,setStatus]=useState<"open"|"completed">("open");
  const today=dayInSeoul(now)||initialToday;
  const [month,setMonth]=useState(initialToday.slice(0,7)), [selected,setSelected]=useState<string|null>(null);
  const [view,setView]=useState<"list"|"calendar">("list");
  const [type,setType]=useState("");
  const actions=useActions(status), schedule=useScheduleItems(status==="open");
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
  const events=Object.values(schedule.details).flatMap(eventsFromDetail).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const sorted=[...actions.rows].sort((a,b)=>(actionDay(a)||"9999").localeCompare(actionDay(b)||"9999")||a.actionId.localeCompare(b.actionId));
  const matching=sorted.filter(action=>(!type||action.type===type)&&(!selected||actionDay(action)===selected));
  const matchingEvents=events.filter(event=>!selected||eventOnDay(event,selected));
  if(home) {
    const due=sorted.filter(action=>action.status!=="completed"&&actionDay(action)&&!isOverdue(action,today,now)).slice(0,4);
    const overdue=sorted.filter(action=>isOverdue(action,today,now));
    const week=events.filter(event=>event.lastDate>=today&&event.date<=weekEnd(today)).slice(0,3);
    return <div data-workspace-loading={actions.busy || schedule.busy} className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
      <section aria-labelledby="home-deadlines"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 id="home-deadlines" className="text-lg font-semibold text-slate-800">놓치면 안 되는 마감</h2><p className="mt-1 text-xs text-slate-400">확정된 기한이 가까운 순서로 확인하세요.</p></div><Link href="/actions" className="inline-flex items-center gap-1 text-xs text-[#6d88b0]">전체<ArrowRight className="size-3.5"/></Link></div>
      {actions.busy?<WorkspaceSkeleton/>:actions.error?<p role="alert" className="text-sm text-red-600">{actions.error}<button onClick={actions.reload} className="ml-2 underline">다시 시도</button></p>:<><div className="space-y-2.5">{due.map(action=><ActionRow key={action.actionId} action={action} today={today} now={now} compact/>)}</div>{!due.length&&<p className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 text-sm text-slate-400">다가오는 확정 마감이 없습니다.</p>}{!!overdue.length&&<Link href="/actions" className="mt-3 inline-block text-xs text-orange-600">기한이 지난 할 일 {overdue.length}건도 확인해 주세요 →</Link>}</>}
      </section>
      <section aria-labelledby="home-week"><div className="mb-4 flex items-center justify-between"><div><h2 id="home-week" className="text-lg font-semibold text-slate-800">이번 주 일정</h2><p className="mt-1 text-xs text-slate-400">행사·회의 날짜는 마감과 구분해 보여드려요.</p></div><CalendarDays className="size-4 text-[#7f99be]"/></div><div className="space-y-2.5">{week.map(event=><EventRow key={event.id} event={event}/>)}</div>{schedule.busy?<WorkspaceSkeleton rows={1}/>:!week.length&&<p className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 text-sm text-slate-400">확인된 이번 주 일정이 없습니다.</p>}{schedule.error&&<p role="alert" className="mt-2 text-xs text-orange-600">{schedule.error}<button className="ml-2 underline" onClick={schedule.reload}>다시 시도</button></p>}{schedule.hasMore&&<Link href="/actions" className="mt-3 inline-block text-xs text-[#6d88b0]">최근 100개 자료의 일정 · 전체 조회 계속하기 →</Link>}</section>
    </div>;
  }
  const groups=[{key:"overdue",label:"기한 지남",color:"text-red-500"},{key:"week",label:"이번 주",color:"text-[#5f7fae]"},{key:"next",label:"다음 주",color:"text-slate-600"},{key:"later",label:"이후 일정",color:"text-slate-600"},{key:"review",label:"날짜·조건 확인 필요",color:"text-amber-600"}];
  return <div data-workspace-loading={actions.busy || (status === "open" && schedule.busy)}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-slate-800">할 일 · 일정</h1><p className="mt-2 text-xs leading-6 text-slate-400 sm:text-sm">메일·문서·메모에서 찾은 할 일과 날짜예요. 근거를 눌러 원문을 확인하세요.</p></div><div className="flex rounded-xl border border-slate-200/60 bg-white p-1">{([['list','목록'],['calendar','캘린더']] as const).map(([value,label])=><button key={value} onClick={()=>setView(value)} aria-pressed={view===value} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${view===value?"bg-[#edf2fa] text-[#5f7fae]":"text-slate-400"}`}>{label}</button>)}</div></div>
    {view==="list"&&<div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><div className="flex rounded-full border border-slate-200/70 bg-white p-1">{([['open','진행 중'],['completed','완료']] as const).map(([value,label])=><button key={value} aria-pressed={status===value} className={`rounded-full px-4 py-1.5 text-xs ${status===value?"bg-[#eaf0fa] font-semibold text-[#5f7fae]":"text-slate-400"}`} onClick={()=>{setStatus(value);setSelected(null);}}>{label}</button>)}</div><select aria-label="할 일 유형" value={type} onChange={event=>setType(event.target.value)} className="rounded-full border border-slate-200/70 bg-white px-3 py-2 text-xs text-slate-500"><option value="">모든 유형</option><option value="required">해야 할 일</option><option value="optional">신청·선택</option><option value="check">조건 확인</option></select></div><div className="flex items-center gap-4"><span className="text-[11px] text-slate-400">마감일순</span></div></div>}
    {view==="list"&&selected&&<div className="mb-4 flex items-center gap-3 text-sm text-[#5f7fae]"><span>{shortDate(selected)}의 마감·일정</span><button aria-label="날짜 필터 해제" onClick={()=>setSelected(null)} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs"><X className="size-3"/>전체 날짜</button></div>}
    {view==="calendar"?<>
      {(status==="completed"||type)&&<p className="mb-3 text-xs text-slate-400">목록의 {status==="completed"?"완료 상태":"유형"} 필터 적용 중 <button onClick={()=>{setStatus("open");setType("");}} className="ml-2 text-[#6d88b0] underline">필터 해제</button></p>}
      {actions.error&&<p role="alert" className="mb-4 text-sm text-red-600">{actions.error}<button onClick={actions.reload} className="ml-2 underline">다시 시도</button></p>}
      <FullMonthCalendar month={month} onMonth={setMonth} today={today} actions={sorted.filter(action=>!type||action.type===type)} events={status==="open"?events:[]} selected={selected} onSelect={setSelected} busy={actions.busy||(status==="open"&&schedule.busy)}/>
      {status==="open"&&<div className="mt-4 text-xs leading-5 text-slate-400">{schedule.busy?<p role="status">일정과 근거를 확인하는 중… {Object.keys(schedule.details).length}/{schedule.items.length}</p>:<p>조회한 자료 {schedule.items.length}개에서 확인한 일정입니다.</p>}{schedule.error&&<p role="alert" className="mt-2 text-orange-600">{schedule.error}<button onClick={schedule.reload} className="ml-2 underline">다시 시도</button></p>}{schedule.hasMore&&<button disabled={schedule.busy} onClick={schedule.loadMore} className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[#6d88b0] disabled:opacity-50">이전 자료의 일정 더 불러오기</button>}</div>}
    </>:<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_310px]">
      <div className="order-1">
        {actions.error&&<p role="alert" className="mb-4 text-sm text-red-600">{actions.error}<button onClick={actions.reload} className="ml-2 underline">다시 시도</button></p>}
        {actions.busy?<WorkspaceSkeleton/>:status==="completed"?<section><h2 className="mb-3 text-sm font-semibold text-slate-600">완료한 할 일 <span className="ml-2 text-xs text-slate-400">{matching.length}</span></h2><div className="space-y-3">{matching.map(action=><ActionRow key={action.actionId} action={action} today={today} now={now}/>)}</div>{!matching.length&&<p className="py-8 text-sm text-slate-400">완료한 할 일이 없습니다.</p>}</section>:<div className="space-y-7">{groups.map(group=>{
          const taskRows=matching.filter(action=>actionGroup(action,today,now)===group.key);
          const eventRows=matchingEvents.filter(event=>eventGroup(event,today)===group.key);
          return <section key={group.key} aria-label={group.label}><h2 className={`mb-3 text-sm font-semibold ${group.color}`}>{group.label}<span className="ml-2 text-xs font-normal text-slate-400">할 일 {taskRows.length}{eventRows.length?` · 일정 ${eventRows.length}`:""}</span></h2><div className="space-y-3">{taskRows.map(action=><ActionRow key={action.actionId} action={action} today={today} now={now}/>)}</div>{eventRows.length>0&&<div className="mt-3 space-y-2"><p className="text-[11px] text-slate-400">Calendar · 자료에서 찾은 일정</p>{eventRows.map(event=><EventRow key={event.id} event={event}/>)}</div>}{!taskRows.length&&!eventRows.length&&<p className="border-b border-slate-200/50 pb-4 text-xs text-slate-400">해당하는 할 일이나 일정이 없습니다.</p>}</section>;
        })}{selected&&matchingEvents.some(event=>eventGroup(event,today)==="past")&&<section><h2 className="mb-3 text-sm font-semibold text-slate-500">지난 일정</h2><div className="space-y-2">{matchingEvents.filter(event=>eventGroup(event,today)==="past").map(event=><EventRow key={event.id} event={event}/>)}</div></section>}</div>}
      </div>
      <aside className="order-2 space-y-3 lg:sticky lg:top-20"><MonthCalendar month={month} onMonth={setMonth} today={today} actions={sorted} events={status==="open"?events:[]} selected={selected} onSelect={setSelected}/>{status==="open"&&<div className="text-xs leading-5 text-slate-400">{schedule.busy?<p role="status">일정과 근거를 확인하는 중… {Object.keys(schedule.details).length}/{schedule.items.length}</p>:<p>조회한 자료 {schedule.items.length}개에서 확인한 일정입니다.</p>}{schedule.error&&<p role="alert" className="mt-2 text-orange-600">{schedule.error}<button onClick={schedule.reload} className="ml-2 underline">다시 시도</button></p>}{schedule.hasMore&&<button disabled={schedule.busy} onClick={schedule.loadMore} className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[#6d88b0] disabled:opacity-50">이전 자료의 일정 더 불러오기</button>}</div>}</aside>
    </div>}
  </div>;
}
