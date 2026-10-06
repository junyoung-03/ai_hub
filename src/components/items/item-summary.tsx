import { documentLabels, formatLabels, sourceLabels, statusLabels, formatTimestamp } from "@/lib/items/presentation";
import type { ItemDetail, ItemList } from "@/lib/items/queries";
import Link from "next/link";
import { FormatPreview } from "@/components/search/search-results";

export function ItemCard({ item, tile = false }: { item: ItemList["items"][number]; tile?: boolean }) {
  return <Link href={`/items/${item.id}`} className={tile ? "flex min-w-0 flex-col rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-canvas" : "flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-canvas"}>
    <FormatPreview format={item.format} />
    <div className={`min-w-0 flex-1 ${tile ? "mt-3" : ""}`}><p className="line-clamp-2 break-words text-base font-medium">{item.title}</p><p className="meta mt-1">{sourceLabels[item.source]} · {formatLabels[item.format]} · <ProcessingStatus status={item.processingStatus}/></p>{item.classification.available && <p className="mt-1 text-xs text-faint">{item.classification.primaryTopic ?? "미분류"}{item.classification.origin === "user" ? " · 직접 수정" : ""}</p>}<p className="mt-1 text-xs text-faint">추가 {new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"numeric",day:"numeric"}).format(new Date(item.createdAt))}</p></div>
  </Link>;
}

export function ProcessingStatus({ status }: { status: ItemList["items"][number]["processingStatus"] }) {
  return <span className={`inline-flex text-xs ${status === "failed" ? "rounded bg-rose-soft px-1.5 text-rose" : status === "completed" ? "text-green" : "text-faint"}`}>{statusLabels[status]}</span>;
}

export function ClassificationSummary({ value, detailed = false }: { value: ItemDetail["classification"]; detailed?: boolean }) {
  if (!value.available) return <p className="text-sm text-muted-foreground">아직 분류 결과가 없습니다.</p>;
  const origin = (value: string) => value === "user" ? "직접 수정" : "AI 자동분류";
  return (
    <div className="space-y-2 text-sm">
      <p className="text-sm text-muted-foreground">{origin(value.origin)}</p>
      <p><span className="text-muted-foreground">주제: </span>{value.primaryTopic ?? "미분류"}{detailed && <span className="ml-2 text-sm text-muted-foreground">{origin(value.origins.primaryTopic)}</span>}</p>
      <p><span className="text-muted-foreground">자료 성격: </span>{value.documentType ? documentLabels[value.documentType] : "미분류"}{detailed && <span className="ml-2 text-sm text-muted-foreground">{origin(value.origins.documentType)}</span>}</p>
      <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">태그:</span>{value.tags.length ? value.tags.map((tag, index) => <span key={`${index}:${tag}`} className="max-w-full break-words rounded-md bg-muted px-2 py-1">{tag}</span>) : <span>없음</span>}{detailed && <span className="text-sm text-muted-foreground">{origin(value.origins.tags)}</span>}</div>
    </div>
  );
}

export function ItemMetadata({ item }: { item: ItemList["items"][number] | ItemDetail["item"] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
      <span>{sourceLabels[item.source]}</span><span>·</span><span>{formatLabels[item.format]}</span>
      <ProcessingStatus status={item.processingStatus} />
      {item.source === "gmail" && item.sourceCreatedAt && <time dateTime={item.sourceCreatedAt}>메일 날짜: {formatTimestamp(item.sourceCreatedAt)}</time>}
      <time dateTime={item.createdAt}>추가: {formatTimestamp(item.createdAt)}</time>
    </div>
  );
}
