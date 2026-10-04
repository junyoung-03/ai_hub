import Link from "next/link";
import { Constants } from "@/types/database";
import { documentLabels, formatLabels, sourceLabels, statusLabels } from "@/lib/items/presentation";
import type { ItemQuery } from "@/lib/items/filters";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

export function LibraryFilters({ query }: { query: ItemQuery }) {
  const { filters } = query;
  const enums = Constants.public.Enums;
  return (
    <form action="/library" method="get" className="mb-6 space-y-4 border-b pb-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Source<select name="source" defaultValue={filters.source ?? ""} className={inputClass}><option value="">전체</option>{enums.item_source.map((value) => <option key={value} value={value}>{sourceLabels[value]}</option>)}</select></label>
        <label className="text-sm">Format<select name="format" defaultValue={filters.format ?? ""} className={inputClass}><option value="">전체</option>{enums.item_format.map((value) => <option key={value} value={value}>{formatLabels[value]}</option>)}</select></label>
        <label className="text-sm">Topic<input name="topic" defaultValue={filters.topic ?? ""} maxLength={1024} placeholder="Topic 정확히 일치" className={inputClass} /></label>
        <label className="text-sm">Document Type<select name="documentType" defaultValue={filters.documentType ?? ""} className={inputClass}><option value="">전체</option>{enums.document_type.map((value) => <option key={value} value={value}>{documentLabels[value]}</option>)}</select></label>
        <label className="text-sm">처리 상태<select name="processingStatus" defaultValue={filters.processingStatus ?? ""} className={inputClass}><option value="">전체</option>{enums.processing_status.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">추가일 시작 (UTC)<input type="date" name="from" defaultValue={filters.from ?? ""} className={inputClass} /></label>
          <label className="text-sm">추가일 종료 (UTC)<input type="date" name="to" defaultValue={filters.to ?? ""} className={inputClass} /></label>
        </div>
      </div>
      {query.limit !== 30 && <input type="hidden" name="limit" value={query.limit} />}
      <div className="flex items-center gap-4"><button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">필터 적용</button><Link href="/library" className="text-sm underline underline-offset-4">초기화</Link></div>
    </form>
  );
}
