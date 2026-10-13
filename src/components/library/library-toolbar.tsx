import Link from "next/link";
import { Constants } from "@/types/database";
import { documentLabels, formatLabels } from "@/lib/items/presentation";
import { libraryUrl, type ItemQuery } from "@/lib/items/filters";
import { workspaceSources } from "@/components/workspace/workspace-ui";

export function LibraryToolbar({ query, promotionalEnabled = false }: { query: ItemQuery; promotionalEnabled?: boolean }) {
  const { filters } = query;
  const hasFilters = Boolean(filters.topic || filters.documentType || filters.format || filters.from || filters.to);
  const resetUrl = libraryUrl({ ...query, filters: { source: filters.source, includePromotional: filters.includePromotional } });
  const selectClass = "mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-200/70 bg-white/90 px-3 text-xs text-slate-500";
  return <div className="mb-5 space-y-3">
    <nav aria-label="자료 출처 필터" className="flex flex-wrap gap-2">
      {[{ value: "", label: "전체" }, ...workspaceSources].map(source => {
        const value = source.value as NonNullable<ItemQuery["filters"]["source"]>;
        const url = libraryUrl({ ...query, filters: { ...filters, source: value || undefined } });
        const selected = (filters.source ?? "") === source.value;
        return <Link key={source.value} href={url} aria-current={selected ? "page" : undefined} className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-xs ${selected ? "border-[#c7d5ea] bg-[#eaf0fa] font-semibold text-[#5f7fae]" : "border-slate-200/70 bg-white/85 text-slate-500 hover:border-[#c7d5ea]"}`}>
          {"Icon" in source && <source.Icon className="size-3.5 text-slate-400" aria-hidden="true"/>}{source.label}
        </Link>;
      })}
    </nav>
    {promotionalEnabled && <Link href={libraryUrl({ ...query, filters: { ...filters, includePromotional: filters.includePromotional ? undefined : "true" } })} role="switch" aria-checked={Boolean(filters.includePromotional)} className="inline-flex min-h-9 items-center gap-2 text-xs text-slate-600">
      <span aria-hidden="true" className={`h-4 w-7 rounded-full border ${filters.includePromotional ? "border-blue-400 bg-blue-200" : "border-slate-300 bg-slate-100"}`}/>광고 포함
    </Link>}
    <details open={hasFilters}>
      <summary className="w-fit cursor-pointer rounded-lg px-1 py-2 text-xs text-slate-500">분류 · 상세 필터{hasFilters ? " · 적용 중" : ""}</summary>
      <form action="/library" method="get" className="mt-2 space-y-3 rounded-xl border border-slate-200/70 bg-white/80 p-4">
        {(["source", "processingStatus", "includePromotional"] as const).map(key => filters[key] && <input key={key} type="hidden" name={key} value={filters[key]}/>)}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-500">주제<input name="topic" defaultValue={filters.topic ?? ""} maxLength={1024} placeholder="표시된 주제와 정확히 일치" className={selectClass}/></label>
          <label className="text-xs text-slate-500">자료 성격<select name="documentType" defaultValue={filters.documentType ?? ""} className={selectClass}><option value="">모든 자료 성격</option>{Constants.public.Enums.document_type.map(value => <option key={value} value={value}>{documentLabels[value]}</option>)}</select></label>
        </div>
        <p className="text-xs text-slate-400">저장된 분류로 찾습니다. 직접 수정한 분류가 있으면 그 값을 우선합니다.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-500">형식<select name="format" defaultValue={filters.format ?? ""} className={selectClass}><option value="">모든 형식</option>{Constants.public.Enums.item_format.map(value => <option key={value} value={value}>{formatLabels[value]}</option>)}</select></label>
          <label className="text-xs text-slate-500">추가일 시작 (UTC)<input name="from" type="date" defaultValue={filters.from ?? ""} className={selectClass}/></label>
          <label className="text-xs text-slate-500">추가일 종료 (UTC)<input name="to" type="date" defaultValue={filters.to ?? ""} className={selectClass}/></label>
        </div>
        {query.limit !== 30 && <input type="hidden" name="limit" value={query.limit}/>}
        <div className="flex items-center gap-4"><button className="min-h-10 rounded-xl border border-[#ced9ea] bg-white px-4 text-xs text-[#5f7fae]">필터 적용</button><Link href={resetUrl} className="text-xs text-slate-500 underline">필터 해제</Link></div>
      </form>
    </details>
    {filters.processingStatus && <p className="text-xs text-slate-500">페이지 주소의 처리 상태 조건이 적용돼 있습니다. <Link href={resetUrl} className="underline">조건 해제</Link></p>}
  </div>;
}
