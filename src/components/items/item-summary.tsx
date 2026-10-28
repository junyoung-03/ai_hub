import { documentLabels, formatLabels, sourceLabels, statusLabels, formatTimestamp } from "@/lib/items/presentation";
import type { ItemDetail, ItemList } from "@/lib/items/queries";
import Link from "next/link";
import { FormatPreview } from "@/components/search/search-results";
import type { ProcessingSummary } from "@/lib/items/processing";

export function ItemCard({ item, tile = false }: { item: ItemList["items"][number]; tile?: boolean }) {
  return <Link href={`/items/${item.id}`} className={tile ? "flex min-w-0 flex-col rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-canvas" : "flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-canvas"}>
    <FormatPreview format={item.format} />
    <div className={`min-w-0 flex-1 ${tile ? "mt-3" : ""}`}><p className="line-clamp-2 break-words text-base font-medium">{item.title}</p><p className="meta mt-1">{sourceLabels[item.source]} · {formatLabels[item.format]} · <ProcessingStatus status={item.processingStatus}/></p>{item.classification.available && <p className="mt-1 text-xs text-faint">{item.classification.primaryTopic ?? "미분류"}{item.classification.origin === "user" ? " · 직접 수정" : ""}</p>}<p className="mt-1 text-xs text-faint">추가 {new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"numeric",day:"numeric"}).format(new Date(item.createdAt))}</p></div>
  </Link>;
}

export function ProcessingStatus({ status, summary }: { status: ItemList["items"][number]["processingStatus"]; summary?: ProcessingSummary }) {
  return <span className={`inline-flex text-xs ${status === "failed" ? "rounded bg-rose-soft px-1.5 text-rose" : status === "completed" ? "text-green" : "text-faint"}`}>{summary?.label ?? statusLabels[status]}</span>;
}

export function ClassificationSummary({ value, detailed = false, compact = false }: { value: ItemDetail["classification"]; detailed?: boolean; compact?: boolean }) {
  if (!value.available) return <p className="text-sm text-muted-foreground">아직 분류 결과가 없습니다.</p>;
  const origin = (value: string) => value === "user" ? "직접 수정" : "AI 자동분류";
  if (compact) return <div className="space-y-3">
    <dl className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3">
      <dt className="text-sm text-muted-foreground">주제</dt><dd className="break-words text-lg font-semibold text-ink">{value.primaryTopic ?? "미분류"}</dd>
      <dt className="text-sm text-muted-foreground">유형</dt><dd className="break-words text-lg font-semibold text-ink">{value.documentType ? documentLabels[value.documentType] : "미분류"}</dd>
      {value.tags.length > 0 && <><dt className="text-sm text-muted-foreground">태그</dt><dd className="flex min-w-0 flex-wrap gap-2" aria-label="태그">{value.tags.map((tag,index) => <span className="max-w-full break-words rounded-lg border border-line bg-brand-soft px-3 py-1.5 text-sm font-medium text-ink" key={`${index}:${tag}`}>{tag}</span>)}</dd></>}
    </dl>
    <p className="text-xs text-muted-foreground">{origin(value.origin)}</p>
  </div>;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-sm text-muted-foreground">{origin(value.origin)}</p>
      <p><span className="text-muted-foreground">주제: </span>{value.primaryTopic ?? "미분류"}{detailed && <span className="ml-2 text-sm text-muted-foreground">{origin(value.origins.primaryTopic)}</span>}</p>
      <p><span className="text-muted-foreground">자료 성격: </span>{value.documentType ? documentLabels[value.documentType] : "미분류"}{detailed && <span className="ml-2 text-sm text-muted-foreground">{origin(value.origins.documentType)}</span>}</p>
      <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">태그:</span>{value.tags.length ? value.tags.map((tag, index) => <span key={`${index}:${tag}`} className="max-w-full break-words rounded-md bg-muted px-2 py-1">{tag}</span>) : <span>없음</span>}{detailed && <span className="text-sm text-muted-foreground">{origin(value.origins.tags)}</span>}</div>
    </div>
  );
}

export function ItemMetadata({ item, processing }: { item: ItemList["items"][number] | ItemDetail["item"]; processing?: ProcessingSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
      <span>{sourceLabels[item.source]}</span><span>·</span><span>{formatLabels[item.format]}</span>
      <ProcessingStatus status={item.processingStatus} summary={processing} />
      {item.source === "gmail" && item.sourceCreatedAt && <time dateTime={item.sourceCreatedAt}>메일 날짜: {formatTimestamp(item.sourceCreatedAt)}</time>}
      <time dateTime={item.createdAt}>추가: {formatTimestamp(item.createdAt)}</time>
    </div>
  );
}
