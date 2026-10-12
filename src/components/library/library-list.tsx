"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Search } from "lucide-react";
import type { LibraryItem } from "@/components/actions/use-workspace-data";
import { useItemDetails } from "@/components/actions/use-workspace-data";
import { shortDate, eventsFromDetail, unresolvedEventsFromDetail } from "@/components/actions/schedule-model";
import { SourceBadge } from "@/components/workspace/workspace-ui";
import { formatLabels } from "@/lib/items/presentation";

function processingLabel(item: LibraryItem) {
  switch (item.processingStatus) {
    case "failed": return { label: "처리 실패 · 상세에서 재시도", color: "text-red-500" };
    case "analyzing": return { label: "AI 분석 중", color: "text-[#6c8cb9]" };
    case "extracting": return { label: item.format === "image" || item.format === "screenshot" ? "OCR 추출 중" : "콘텐츠 추출 중", color: "text-amber-600" };
    case "indexing": return { label: "검색 준비 중", color: "text-[#6c8cb9]" };
    case "queued": return { label: "분석 대기 중", color: "text-slate-500" };
    case "uploaded": return { label: "업로드 완료 · 추출 대기", color: "text-slate-500" };
    case "completed": return null;
  }
}

export function LibraryList({ items, toolbar }: { items: LibraryItem[]; toolbar?: ReactNode }) {
  const [query, setQuery] = useState("");
  const { details, busy, error, reload } = useItemDetails(items);
  const needle = query.trim().toLocaleLowerCase();
  const shown = items.filter(item => !needle || [item.title, details[item.id]?.item.contentText ?? ""].some(value => value.toLocaleLowerCase().includes(needle)));
  return <div data-library-loading={busy}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <label className="flex min-h-11 w-full max-w-lg items-center gap-2.5 rounded-xl border border-slate-200/70 bg-white/90 px-3.5"><Search className="size-4 shrink-0 text-slate-400" aria-hidden="true"/><span className="sr-only">현재 페이지 제목·본문 검색</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="현재 목록에서 제목·본문 찾기" maxLength={500} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"/></label>
      <Link href={needle ? `/search?q=${encodeURIComponent(query.trim())}` : "/"} className="inline-flex items-center gap-1.5 text-xs text-[#6d88b0]">전체 자료 검색<ArrowRight className="size-3.5"/></Link>
    </div>
    {toolbar}
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/90">
      <div className="hidden grid-cols-[minmax(0,1fr)_100px_104px] gap-4 border-b border-slate-100 bg-[#f8fafe] px-5 py-3 text-[11px] text-slate-400 lg:grid"><span>제목 · 내용</span><span>출처</span><span className="text-right">추가일</span></div>
      <ul className="divide-y divide-slate-100">{shown.map(item => {
        const detail = details[item.id], status = processingLabel(item);
        const currentActions = detail?.actions.filter(action => detail.evidence.some(evidence => evidence.actionId === action.id && evidence.isCurrent && evidence.itemId === item.id));
        const deadlines = currentActions?.filter(action => action.deadlineStatus === "confirmed").length;
        const events = detail ? eventsFromDetail(detail).length : 0;
        const unresolved = detail ? unresolvedEventsFromDetail(detail).length : 0;
        const subtitle = detail?.gmail?.from || detail?.item.contentText?.split(/\n/).find(line => line.trim() && line.trim() !== item.title) || formatLabels[item.format];
        return <li key={item.id}><Link href={`/items/${item.id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 p-4 transition-colors hover:bg-[#f8fafe] lg:grid-cols-[minmax(0,1fr)_100px_104px] lg:items-center lg:px-5 lg:py-4">
          <div className="flex min-w-0 gap-3"><span className="mt-1 hidden shrink-0 sm:inline-flex"><SourceBadge source={item.source} iconOnly/></span><div className="min-w-0">
            <h2 className="line-clamp-2 break-words text-sm font-semibold leading-6 text-slate-700">{item.title}</h2><p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-400">{subtitle}</p>
            <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
              {status && <span className={`inline-flex items-center gap-1.5 ${status.color}`}><FileText className="size-3" aria-hidden="true"/>{status.label}</span>}
              {!!currentActions?.length && <span className="text-slate-500">할 일 {currentActions.length}</span>}
              {!!deadlines && <span className="text-orange-600">마감 {deadlines}</span>}
              {!!events && <span className="text-[#6c8cb9]">일정 {events}</span>}
              {!!unresolved && <span className="text-amber-700">날짜 확인 필요 {unresolved}</span>}
            </div>
          </div></div>
          <SourceBadge source={item.source}/>
          <time dateTime={item.createdAt} className="col-span-2 text-[11px] text-slate-400 lg:col-span-1 lg:text-right">{shortDate(item.createdAt)}</time>
        </Link></li>;
      })}</ul>
      {!shown.length && <p className="py-12 text-center text-sm text-slate-400">{needle ? "현재 목록에서 일치하는 자료를 찾지 못했습니다." : "조건에 맞는 자료가 없습니다."}</p>}
    </div>
    <div aria-live="polite" className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-400"><span>현재 페이지 {shown.length}개{needle ? ` / ${items.length}개` : ""}</span>{busy && <span>본문·분석 상태 확인 중…</span>}{error && <span role="alert">{error}<button onClick={reload} className="ml-2 underline">다시 시도</button></span>}</div>
  </div>;
}
