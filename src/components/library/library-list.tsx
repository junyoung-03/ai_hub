"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, FileText, Search } from "lucide-react";
import type { LibraryItem } from "@/components/actions/use-workspace-data";
import { useItemDetails } from "@/components/actions/use-workspace-data";
import { shortDate, eventsFromDetail } from "@/components/actions/schedule-model";
import { SourceBadge } from "@/components/workspace/workspace-ui";
import { documentLabels, formatLabels } from "@/lib/items/presentation";
import type { ItemDetailResponse } from "@/types/items";

function processingLabel(item:LibraryItem,detail?:ItemDetailResponse) {
  switch(item.processingStatus) {
    case "failed": return {label:"처리 실패",color:"text-red-500"};
    case "analyzing": return {label:"AI 분석 중",color:"text-[#6c8cb9]"};
    case "extracting": return {label:item.format==="image"||item.format==="screenshot"?"OCR 추출 중":"콘텐츠 추출 중",color:"text-amber-600"};
    case "indexing": return {label:"검색 색인 중",color:"text-[#6c8cb9]"};
    case "queued": return {label:"대기 중",color:"text-slate-400"};
    case "uploaded": return {label:"업로드 완료 · 추출 대기",color:"text-slate-400"};
    case "completed": return detail?.aiAnalysis ? {label:"분석 완료",color:"text-emerald-600"} : item.source==="calendar" ? {label:"일정 수집 완료",color:"text-emerald-600"} : detail ? {label:"수집·추출 완료",color:"text-slate-500"} : {label:"처리 완료",color:"text-slate-500"};
  }
}
export function LibraryList({items}:{items:LibraryItem[]}) {
  const [query,setQuery]=useState("");
  const {details,busy,error,reload}=useItemDetails(items);
  const needle=query.trim().toLocaleLowerCase();
  const shown=items.filter(item=>!needle||[item.title,item.classification.primaryTopic??"",details[item.id]?.item.contentText??""].some(value=>value.toLocaleLowerCase().includes(needle)));
  return <div data-library-loading={busy}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><label className="flex min-h-11 w-full max-w-lg items-center gap-2.5 rounded-xl border border-slate-200/70 bg-white/90 px-3.5"><Search className="size-4 shrink-0 text-slate-400" aria-hidden="true"/><span className="sr-only">현재 페이지 제목·본문 검색</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="현재 목록에서 제목·본문 찾기" maxLength={500} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"/></label><Link href={query.trim()?`/search?q=${encodeURIComponent(query.trim())}`:"/search"} className="inline-flex items-center gap-1.5 text-xs text-[#6d88b0]">전체 자료 검색<ArrowRight className="size-3.5"/></Link></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/90">
      <div className="hidden grid-cols-[minmax(0,1fr)_88px_104px_136px_84px] gap-4 border-b border-slate-100 bg-[#f8fafe] px-5 py-3 text-[11px] text-slate-400 lg:grid"><span>제목 · 내용</span><span>출처</span><span>분류</span><span>처리·분석 상태</span><span className="text-right">추가일</span></div>
      <ul className="divide-y divide-slate-100">{shown.map(item=>{
        const detail=details[item.id], status=processingLabel(item,detail);
        const currentActions=detail?.actions.filter(action=>detail.evidence.some(evidence=>evidence.actionId===action.id&&evidence.isCurrent&&evidence.itemId===item.id));
        const deadlines=currentActions?.filter(action=>action.deadlineStatus==="confirmed").length;
        const events=detail?eventsFromDetail(detail).length:undefined;
        const topic=item.classification.primaryTopic;
        const subtitle=detail?.gmail?.from||detail?.item.contentText?.split(/\n/).find(line=>line.trim()&&line.trim()!==item.title)||formatLabels[item.format];
        return <li key={item.id}><Link href={`/items/${item.id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 p-4 transition-colors hover:bg-[#f8fafe] lg:grid-cols-[minmax(0,1fr)_88px_104px_136px_84px] lg:items-center lg:px-5 lg:py-4">
          <div className="flex min-w-0 gap-3"><span className="mt-1 hidden shrink-0 sm:inline-flex"><SourceBadge source={item.source} iconOnly/></span><div className="min-w-0"><h2 className="line-clamp-2 break-words text-sm font-semibold leading-6 text-slate-700">{item.title}</h2><p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-400">{subtitle}</p>{detail&&<div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">{!!currentActions?.length&&<span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">할 일 {currentActions.length}</span>}{!!deadlines&&<span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-600">마감 {deadlines}</span>}{!!events&&<span className="rounded bg-blue-50 px-1.5 py-0.5 text-[#6c8cb9]">일정 {events}</span>}</div>}</div></div>
          <div className="lg:contents"><SourceBadge source={item.source}/><div className="mt-1 hidden min-w-0 lg:block">{topic?<span className="inline-block max-w-full truncate rounded-md bg-[#f2f5fa] px-2 py-1 text-[11px] text-slate-500" title={topic}>{topic}</span>:<span className="text-xs text-slate-300">미분류</span>}{item.classification.origin==="user"&&<p className="mt-1 text-[10px] text-[#6d88b0]">직접 수정</p>}{!topic&&item.classification.documentType&&<p className="text-[11px] text-slate-400">{documentLabels[item.classification.documentType]}</p>}</div></div>
          <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 text-xs lg:col-span-1 lg:contents"><span className={`inline-flex items-center gap-1.5 text-[11px] ${status.color}`}>{item.processingStatus==="completed"?<Check className="size-3" aria-hidden="true"/>:<FileText className="size-3" aria-hidden="true"/>}{status.label}</span><span className="text-[11px] text-slate-400 lg:text-right"><time dateTime={item.createdAt}>{shortDate(item.createdAt)}</time></span></div>
          {topic&&<p className="col-span-2 text-[11px] text-slate-400 lg:hidden">분류 · {topic}{item.classification.origin==="user"?" · 직접 수정":""}</p>}
        </Link></li>;
      })}</ul>
      {!shown.length&&<p className="py-12 text-center text-sm text-slate-400">{needle?"현재 목록에서 일치하는 자료를 찾지 못했습니다.":"조건에 맞는 자료가 없습니다."}</p>}
    </div>
    <div aria-live="polite" className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-400"><span>현재 페이지 {shown.length}개{needle?` / ${items.length}개`:""}</span>{busy&&<span>본문·분석 상태 확인 중…</span>}{error&&<span role="alert">{error}<button onClick={reload} className="ml-2 underline">다시 시도</button></span>}</div>
  </div>;
}
