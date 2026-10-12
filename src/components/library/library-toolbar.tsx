import Link from "next/link";
import { Constants } from "@/types/database";
import { documentLabels, formatLabels } from "@/lib/items/presentation";
import { libraryUrl, type ItemQuery } from "@/lib/items/filters";
import { workspaceSources } from "@/components/workspace/workspace-ui";

export function LibraryToolbar({query}:{query:ItemQuery}) {
  const {filters}=query;
  const selectClass="min-h-10 w-full min-w-0 rounded-xl border border-slate-200/70 bg-white/90 px-3 text-xs text-slate-500";
  return <div className="mb-5 space-y-4">
    <nav aria-label="자료 출처 필터" className="flex flex-wrap gap-2">{[{value:"",label:"전체"},...workspaceSources].map(source=>{
      const value=source.value as NonNullable<ItemQuery["filters"]["source"]>;
      const url=libraryUrl({...query,filters:{...filters,source:value||undefined}});
      const selected=(filters.source??"")===source.value;
      return <Link key={source.value} href={url} aria-current={selected?"page":undefined} className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-xs ${selected?"border-[#c7d5ea] bg-[#eaf0fa] font-semibold text-[#5f7fae]":"border-slate-200/70 bg-white/85 text-slate-500 hover:border-[#c7d5ea]"}`}>{"Icon" in source&&<source.Icon className={`size-3.5 ${source.color}`} aria-hidden="true"/>}{source.label}</Link>;
    })}</nav>
    <form action="/library" method="get" className="space-y-3">
      {filters.source&&<input type="hidden" name="source" value={filters.source}/>}
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-40 flex-1 text-[11px] text-slate-400 sm:max-w-52">주제<input name="topic" defaultValue={filters.topic??""} maxLength={1024} placeholder="모든 주제 · 정확히 일치" className={`${selectClass} mt-1`}/></label><label className="min-w-40 flex-1 text-[11px] text-slate-400 sm:max-w-44">분류<select name="documentType" defaultValue={filters.documentType??""} className={`${selectClass} mt-1`}><option value="">모든 분류</option>{Constants.public.Enums.document_type.map(value=><option key={value} value={value}>{documentLabels[value]}</option>)}</select></label><label className="min-w-40 flex-1 text-[11px] text-slate-400 sm:max-w-44">처리 상태<select name="processingStatus" defaultValue={filters.processingStatus??""} className={`${selectClass} mt-1`}><option value="">모든 상태</option>{[["uploaded","업로드 완료"],["queued","대기 중"],["extracting","콘텐츠 추출 중"],["analyzing","AI 분석 중"],["indexing","검색 색인 중"],["completed","처리 완료"],["failed","실패"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className="min-h-10 rounded-xl border border-[#ced9ea] bg-white px-4 text-xs text-[#5f7fae]">적용</button><Link href="/library" className="inline-flex min-h-10 items-center text-xs text-slate-400 hover:text-slate-600">초기화</Link></div>
      <details open={Boolean(filters.format||filters.from||filters.to)}><summary className="cursor-pointer text-[11px] text-slate-400">형식·추가일 필터</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-[11px] text-slate-400">형식<select name="format" defaultValue={filters.format??""} className={`${selectClass} mt-1`}><option value="">모든 형식</option>{Constants.public.Enums.item_format.map(value=><option key={value} value={value}>{formatLabels[value]}</option>)}</select></label><label className="text-[11px] text-slate-400">추가일 시작 (UTC)<input name="from" type="date" defaultValue={filters.from??""} className={`${selectClass} mt-1`}/></label><label className="text-[11px] text-slate-400">추가일 종료 (UTC)<input name="to" type="date" defaultValue={filters.to??""} className={`${selectClass} mt-1`}/></label></div></details>
      {query.limit!==30&&<input type="hidden" name="limit" value={query.limit}/>}
    </form>
  </div>;
}
