import Link from "next/link";
import { formatTimestamp, sourceLabels, formatLabels } from "@/lib/items/presentation";
import type { SearchActionResult, SearchItemResult, SearchLocation } from "@/types/search-ui";
import type { Action } from "@/types/items";

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
export function ActionCard({ action, compact = false }: { action: SearchActionResult; compact?: boolean }) {
  const types: Record<string, string> = { required: "해야 할 일", optional: "신청·선택", check: "조건 확인" };
  return <article className="panel space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="meta">{types[action.type] ?? action.type} · {action.status === "completed" ? "완료" : "진행 중"}</p><h3 className="mt-1 break-words text-base">{action.title}</h3></div><span className="rounded-md bg-accent px-3 py-1 text-sm font-semibold text-primary">{deadlineLabel(action)}</span></div>
    {action.deadlineStatus === "confirmed" && <p className="text-sm">마감 {action.deadlineAt ? formatTimestamp(action.deadlineAt) : action.deadlineDate}</p>}
    {!compact && action.requirements.length > 0 && <p className="text-sm break-words">필요한 것 · {action.requirements.join(" · ")}</p>}
    {!compact && action.conditions.length > 0 && <p className="text-sm break-words">적용 조건 · {action.conditions.join(" · ")}</p>}
    <div className="space-y-3 border-t pt-4">{(compact ? action.sources.slice(0, 1) : action.sources).map((source, i) => <div key={`${source.itemId}:${i}`}><blockquote className={`break-words border-l-2 border-primary/30 pl-3 text-sm ${compact ? "line-clamp-2" : ""}`}>{source.text}</blockquote><Location value={source.location} /><Link className="text-sm text-primary underline-offset-4 hover:underline" href={`/items/${source.itemId}`}>{source.title} →</Link></div>)}</div>
  </article>;
}
export function SearchResultCard({ result }: { result: SearchItemResult }) {
  return <article className="panel space-y-3"><p className="meta">{sourceLabels[result.source as keyof typeof sourceLabels] ?? result.source} · {formatLabels[result.format as keyof typeof formatLabels] ?? result.format}{result.sourceDate ? ` · ${result.sourceDate}` : ""}</p><h2 className="text-base"><Link href={`/items/${result.itemId}`} className="hover:text-primary">{result.title}</Link></h2>{result.matchedChunks.map((match, i) => <div key={i} className="space-y-2"><p className="whitespace-pre-wrap break-words leading-7">{match.excerpt}</p><Location value={match.location} /></div>)}<Link href={`/items/${result.itemId}`} className="inline-block text-sm font-medium text-primary">원문과 분석 보기 →</Link></article>;
}
