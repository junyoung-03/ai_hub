import Link from "next/link";
import { formatTimestamp, sourceLabels, formatLabels } from "@/lib/items/presentation";
import type { SearchActionResult, SearchItemResult, SearchLocation } from "@/types/search-ui";
import type { Action } from "@/types/items";
import { ActionStateButton } from "@/components/items/write-controls";

export function deadlineLabel(action: Pick<Action, "status" | "deadlineStatus" | "deadlineDate" | "deadlineAt"> | SearchActionResult, now = Date.now()) {
  if (action.status === "completed") return "완료";
  if (action.deadlineStatus === "needs_review") return "마감일 확인 필요";
  if (action.deadlineStatus !== "confirmed") return "마감일 없음";
  const date = action.deadlineDate ?? (action.deadlineAt ? new Date(Date.parse(action.deadlineAt) + 9 * 3600000).toISOString().slice(0, 10) : null);
  if (!date) return "마감일 확인 필요";
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  if (action.deadlineAt && Date.parse(action.deadlineAt) < now && days === 0) return "마감 시간 지남";
  return days < 0 ? `기한 초과 +${-days}일` : days === 0 ? "D-DAY" : `D-${days}`;
}
export function Location({ value }: { value: SearchLocation }) {
  return <p className="meta break-words">{value.field === "title" ? "제목 일치" : "원문 근거"}{value.page ? ` · ${value.page}페이지` : ""}{value.tabId ? ` · 탭 ${value.tabId}` : ""}{value.startChar !== null ? ` · 문자 ${value.startChar}–${value.endChar}` : ""}{value.method ? ` · ${value.method}` : ""}</p>;
}
export function FormatPreview({ format }: { format: string }) {
  // Format mark only: no fabricated source content or page counts.
  return <div className="format-preview" aria-hidden="true"><span className="mx-auto mb-1 h-5 w-4 border border-line bg-surface" /><span>{formatLabels[format as keyof typeof formatLabels] ?? format}</span></div>;
}
export function ActionCard({ action, compact = false }: { action: SearchActionResult; compact?: boolean }) {
  const types: Record<string, string> = { required: "해야 할 일", optional: "신청·선택", check: "조건 확인" };
  const label = deadlineLabel(action);
  const pressing = action.status !== "completed" && (label === "D-DAY" || label === "D-1" || label.startsWith("기한 초과") || label === "마감 시간 지남");
  const watch = action.status !== "completed" && action.deadlineStatus === "needs_review";
  const lead = action.sources[0];
  return <article className={`overflow-hidden rounded-xl border ${pressing ? "border-rose/35 bg-rose-soft" : watch ? "border-amber/30 bg-amber-soft" : "border-line bg-surface"}`}>
    <div className="flex gap-4 px-4 py-4 sm:gap-5 sm:px-5">
      <div className="w-24 shrink-0 sm:w-28"><p className={`text-base font-medium tabular-nums ${pressing ? "text-rose" : watch ? "text-amber" : action.status === "completed" ? "text-green" : "text-ink"}`}>{label}</p><p className="mt-1 text-xs text-muted-foreground">{types[action.type] ?? action.type}</p>{pressing && <p className="mt-1 text-xs text-rose">지금 확인</p>}</div>
      <div className="min-w-0 flex-1">
        <h3 className={`text-base font-semibold tracking-[-0.01em] ${action.status === "completed" ? "text-muted-foreground line-through" : ""}`}>{lead ? <Link href={`/items/${lead.itemId}`} className="hover:underline">{action.title}</Link> : action.title}</h3>
        {action.deadlineStatus === "confirmed" && <p className="mt-2 text-sm text-muted-foreground">마감 {action.deadlineAt ? formatTimestamp(action.deadlineAt) : action.deadlineDate}</p>}
        {lead && <p className="mt-2 text-xs text-muted-foreground">{sourceLabels[lead.source as keyof typeof sourceLabels] ?? lead.source} · {lead.title}{action.sources.length > 1 ? ` · 출처 ${action.sources.length}곳` : ""}</p>}
        {!compact && action.requirements.length > 0 && <p className="mt-3 break-words text-sm">필요한 것 · {action.requirements.join(" · ")}</p>}
        {!compact && action.conditions.length > 0 && <p className="mt-1 break-words text-sm">적용 조건 · {action.conditions.join(" · ")}</p>}
        <div className="mt-3 space-y-3">{(compact ? action.sources.slice(0,1) : action.sources).map((source,i)=><div key={`${source.itemId}:${i}`}><blockquote className={`break-words border-l border-line pl-3 text-sm leading-6 text-muted-foreground ${compact ? "line-clamp-2" : ""}`}>{source.text}</blockquote><Location value={source.location} />{!compact && <Link href={`/items/${source.itemId}`} className="text-xs underline-offset-4 hover:underline">{source.title} →</Link>}</div>)}</div>
        <div className="mt-3 flex flex-wrap items-center gap-4">{lead && <Link href={`/items/${lead.itemId}`} className="text-xs underline-offset-4 hover:underline">원문 보기 →</Link>}<ActionStateButton actionId={action.actionId} status={action.status}/></div>
      </div>
      {lead && <div className="hidden lg:block"><FormatPreview format={lead.format} /></div>}
    </div>
  </article>;
}
export function SearchResultCard({ result }: { result: SearchItemResult }) {
  return <article className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-canvas">
    <FormatPreview format={result.format} />
    <div className="min-w-0 flex-1"><h2 className="text-base font-medium"><Link href={`/items/${result.itemId}`} className="hover:underline">{result.title}</Link></h2><p className="meta mt-1">{sourceLabels[result.source as keyof typeof sourceLabels] ?? result.source} · {formatLabels[result.format as keyof typeof formatLabels] ?? result.format}{result.sourceDate ? ` · ${result.sourceDate}` : ""}</p>
      <div className="mt-2 space-y-2">{result.matchedChunks.map((match,i)=><div key={i}><p className="line-clamp-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{match.excerpt}</p><Location value={match.location}/></div>)}</div>
      <Link href={`/items/${result.itemId}`} className="mt-2 inline-block text-xs underline-offset-4 hover:underline">원문과 분석 보기 →</Link>
    </div>
  </article>;
}
