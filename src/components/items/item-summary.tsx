import { documentLabels, formatLabels, sourceLabels, statusLabels, formatTimestamp } from "@/lib/items/presentation";
import type { ItemDetail, ItemList } from "@/lib/items/queries";

export function ProcessingStatus({ status }: { status: ItemList["items"][number]["processingStatus"] }) {
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs ${status === "failed" ? "bg-destructive/10 text-destructive" : status === "completed" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{statusLabels[status]}</span>;
}

export function ClassificationSummary({ value, detailed = false }: { value: ItemDetail["classification"]; detailed?: boolean }) {
  if (!value.available) return <p className="text-sm text-muted-foreground">아직 분류 결과가 없습니다.</p>;
  const origin = (value: string) => value === "user" ? "User Edited" : "AI Generated";
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-muted-foreground">{origin(value.origin)}</p>
      <p><span className="text-muted-foreground">Topic: </span>{value.primaryTopic ?? "미분류"}{detailed && <span className="ml-2 text-xs text-muted-foreground">{origin(value.origins.primaryTopic)}</span>}</p>
      <p><span className="text-muted-foreground">Document Type: </span>{value.documentType ? documentLabels[value.documentType] : "미분류"}{detailed && <span className="ml-2 text-xs text-muted-foreground">{origin(value.origins.documentType)}</span>}</p>
      <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">Tags:</span>{value.tags.length ? value.tags.map((tag, index) => <span key={`${index}:${tag}`} className="max-w-full break-words rounded-md bg-muted px-2 py-1">{tag}</span>) : <span>없음</span>}{detailed && <span className="text-xs text-muted-foreground">{origin(value.origins.tags)}</span>}</div>
    </div>
  );
}

export function ItemMetadata({ item }: { item: ItemList["items"][number] | ItemDetail["item"] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{sourceLabels[item.source]}</span><span>·</span><span>{formatLabels[item.format]}</span>
      <ProcessingStatus status={item.processingStatus} />
      {item.source === "gmail" && item.sourceCreatedAt && <time dateTime={item.sourceCreatedAt}>메일 날짜: {formatTimestamp(item.sourceCreatedAt)}</time>}
      <time dateTime={item.createdAt}>추가: {formatTimestamp(item.createdAt)}</time>
    </div>
  );
}
