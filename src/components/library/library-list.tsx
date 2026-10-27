import type { ReactNode } from "react";
import Link from "next/link";
import { FileText, Plus, Search } from "lucide-react";
import type { LibraryItem } from "@/components/actions/use-workspace-data";
import { shortDate } from "@/components/actions/schedule-model";
import { workspaceSources } from "@/components/workspace/workspace-ui";
import { documentLabels } from "@/lib/items/presentation";

function processingLabel(item: LibraryItem) {
  if (item.processing) return { label: item.processing.label, color: item.processing.canPoll ? "bg-blue-500" : !item.processing.canAnalyze && item.processingStatus !== "completed" ? "bg-slate-400" : item.processingStatus === "failed" ? "bg-red-500" : item.processingStatus === "completed" ? "bg-emerald-500" : "bg-slate-300" };
  switch (item.processingStatus) {
    case "failed": return { label: "분석 실패 · 상세에서 확인", color: "bg-red-500" };
    case "analyzing": return { label: "분석 중", color: "bg-blue-500" };
    case "extracting": return { label: item.format === "image" || item.format === "screenshot" ? "OCR 추출 중" : "콘텐츠 추출 중", color: "bg-amber-500" };
    case "indexing": return { label: "검색 준비 중", color: "bg-blue-500" };
    case "queued": return { label: "분석 대기", color: "bg-slate-300" };
    case "uploaded": return { label: "추출 대기", color: "bg-slate-300" };
    case "completed": return { label: "분석 완료", color: "bg-emerald-500" };
  }
}

export function LibraryList({ items, toolbar, filtered = false }: { items: LibraryItem[]; toolbar?: ReactNode; filtered?: boolean }) {
  return <div>
    <form action="/search" method="get" role="search" className="mb-5 flex min-h-14 items-center gap-3 rounded-2xl border border-blue-100 bg-white/95 px-4 shadow-sm shadow-blue-100/20">
      <Search className="size-5 shrink-0 text-slate-400" aria-hidden="true"/>
      <input name="q" type="search" required maxLength={500} aria-label="자료함 검색어" placeholder="자료함에서 검색하세요..." className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-slate-400"/>
      <button type="submit" aria-label="자료 검색" className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Search className="size-4"/></button>
    </form>
    {toolbar}
    <div className="workspace-card overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,1fr)_120px_130px_180px] gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 text-xs font-medium text-slate-500 lg:grid"><span>제목</span><span>출처</span><span>추가일</span><span>분석 상태</span></div>
      <ul className="divide-y divide-slate-100">{items.map(item => {
        const source = workspaceSources.find(entry => entry.value === item.source);
        const Icon = source?.Icon ?? FileText;
        const status = processingLabel(item);
        return <li key={item.id}><Link href={`/items/${item.id}`} className="grid min-h-20 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-5 transition-colors hover:bg-blue-50/40 lg:grid-cols-[minmax(0,1fr)_120px_130px_180px] lg:px-6">
          <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-100 bg-slate-50 text-slate-400"><Icon className="size-4" aria-hidden="true"/></span><div className="min-w-0"><h2 className="line-clamp-2 text-sm font-semibold leading-6 text-slate-800">{item.title}</h2>
            {item.classification.available && <div className="mt-1 space-y-1 text-xs leading-5 text-slate-500"><p className="break-words">{item.classification.primaryTopic ?? "미분류"}{item.classification.documentType && <> · {documentLabels[item.classification.documentType]}</>}<span className="ml-2 text-slate-400">{item.classification.origin === "user" ? "직접 수정" : "AI 분류"}</span></p>{item.classification.tags.length > 0 && <p className="line-clamp-1 break-words text-slate-400">{item.classification.tags.slice(0, 3).join(" · ")}{item.classification.tags.length > 3 && ` 외 ${item.classification.tags.length - 3}개`}</p>}</div>}
          </div></div>
          <span className="text-xs text-slate-500">{source?.label ?? item.source}</span>
          <time dateTime={item.createdAt} className="text-xs text-slate-500">{shortDate(item.createdAt)}</time>
          <span className="inline-flex items-center justify-end gap-2 text-xs text-slate-500 lg:justify-start" title={item.processing?.message}><span className={`size-1.5 shrink-0 rounded-full ${status.color}`} aria-hidden="true"/>{status.label}</span>
        </Link></li>;
      })}</ul>
      {!items.length && <div className="px-6 py-16 text-center"><FileText className="mx-auto mb-4 size-7 text-slate-300" aria-hidden="true"/><h2 className="font-semibold text-slate-800">{filtered ? "조건에 맞는 자료가 없습니다." : "아직 자료가 없습니다."}</h2><p className="mt-2 text-sm text-slate-500">{filtered ? "출처나 필터 조건을 변경해보세요." : "메일·문서·파일을 추가해보세요."}</p><Link href={filtered ? "/library" : "/library#add-material"} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600">{!filtered && <Plus className="size-4"/>}{filtered ? "필터 초기화" : "자료 추가"}</Link></div>}
    </div>
  </div>;
}
