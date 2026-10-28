"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionCard, SearchResultCard } from "./search-results";
import type { SearchPageResponse } from "@/types/search-ui";
import { formatLabels } from "@/lib/items/presentation";
import { SearchDemoResults } from "./search-demo-results";
import { SourceBadge, WorkspaceSkeleton, workspaceSources } from "@/components/workspace/workspace-ui";
import { GroundedAnswer } from "./grounded-answer";

export function SearchWorkspace({ initialQuery = "", actions = false, today = false, initialNow = 0, promotionalEnabled = false, backHref = "/" }: { initialQuery?: string; actions?: boolean; today?: boolean; initialNow?: number; promotionalEnabled?: boolean; backHref?: "/" | "/library" }) {
  const router = useRouter();
  const [now, setNow] = useState(initialNow);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState(""); const [format, setFormat] = useState("");
  const [includePromotional, setIncludePromotional] = useState(false);
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [semantic, setSemantic] = useState(false);
  const [page, setPage] = useState<SearchPageResponse>(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [tab, setTab] = useState("all"); const abort = useRef<AbortController | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const retryUntil = useRef(0);
  const failedCursor = useRef<string | null>(null);
  const run = useCallback(async (cursor: string | null = null) => {
    if (!query.trim()) return;
    if (Date.now() < retryUntil.current) { setError("검색 요청이 많습니다. 잠시 후 다시 시도해 주세요."); return; }
    if (from && to && from > to) { setError("시작 날짜는 종료 날짜보다 늦을 수 없습니다."); return; }
    failedCursor.current = cursor;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError("");
    try {
      const directActions = actions && !today;
      const parameters = new URLSearchParams({ status: tab === "completed" ? "completed" : "open", limit: "20" });
      if (["required", "optional"].includes(tab)) parameters.set("type", tab);
      if (cursor) parameters.set("cursor", cursor);
      const response = await fetch(directActions ? `/api/v1/actions?${parameters}` : "/api/v1/search", { method: directActions ? "GET" : "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal,
        ...(directActions ? {} : { body: JSON.stringify({ query: query.trim(), filters: { source: source ? [source] : [], format: format ? [format] : [], from: from || null, to: to || null, ...(promotionalEnabled ? { includePromotional } : {}) }, limit: 20, semantic, cursor }) }) });
      if (!response.ok) {
        if (response.status === 410) failedCursor.current = null;
        const wait = Number(response.headers.get("Retry-After"));
        if (response.status === 429) { retryUntil.current = Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 60) * 1000; setRetryAt(retryUntil.current); throw new Error("검색 요청이 많습니다. 잠시 후 다시 시도해 주세요."); }
        throw new Error(response.status === 401 ? "로그인이 만료되었습니다. 다시 로그인해 주세요." : response.status === 410 ? "검색 결과가 만료되었습니다. 다시 검색해 주세요." : "검색을 완료하지 못했습니다. 다시 시도해 주세요.");
      }
      const result = await response.json() as SearchPageResponse;
      if (directActions) { result.mode = "action_sql"; result.appliedFilters = { dateBasis: "action_deadline", from: null, to: null }; result.degraded = false; result.warning = null; result.truncated = false; }
      if (!Array.isArray(result.results) || !(result.nextCursor === null || typeof result.nextCursor === "string")) throw new Error("검색 결과를 읽지 못했습니다.");
      if (!controller.signal.aborted) setPage(previous => cursor && previous ? { ...result, results: [...previous.results, ...result.results] } : result);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "검색을 완료하지 못했습니다."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [query, source, format, from, to, semantic, includePromotional, promotionalEnabled, actions, today, tab]);
  useEffect(() => { const refresh = () => { void run(); }; window.addEventListener("ai-hub:actions-changed", refresh); return () => window.removeEventListener("ai-hub:actions-changed", refresh); }, [run]);
  useEffect(() => {
    abort.current?.abort(); let active = true;
    void Promise.resolve().then(() => { if (active) { setPage(undefined); setError(""); setBusy(false); } });
    const timer = setTimeout(() => { if (query.trim()) void run(); }, 350);
    return () => { active = false; clearTimeout(timer); abort.current?.abort(); };
  }, [run, query]);
  useEffect(() => { if (!retryAt) return; const timer = setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now())); return () => clearTimeout(timer); }, [retryAt]);
  const visible = (page?.results ?? []).filter(r => !actions || r.kind === "action").filter(r => r.kind !== "action" || tab === "all" || (tab === "review" ? r.deadlineStatus === "needs_review" || r.type === "check" : tab === "completed" ? r.status === "completed" : r.type === tab));
  const sorted = today ? [...visible].sort((a, b) => a.kind === "action" && b.kind === "action" ? (a.deadlineStatus === "confirmed" ? a.deadlineDate ?? a.deadlineAt ?? "9999" : "9999").localeCompare(b.deadlineStatus === "confirmed" ? b.deadlineDate ?? b.deadlineAt ?? "9999" : "9999") : 0) : visible;
  return <div className="space-y-6">
    {!actions && promotionalEnabled && <label className="flex min-h-9 items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={includePromotional} onChange={e => { failedCursor.current = null; setIncludePromotional(e.target.checked); }}/>광고 포함</label>}
    {!actions && query.trim() && <>
      <section className="flex items-center gap-3 border-b border-slate-200/60 pb-5 sm:gap-5"><Link href={backHref} className="flex shrink-0 items-center gap-1 text-xs text-slate-500 hover:text-[#557bb9]" aria-label={backHref === "/library" ? "자료함으로 돌아가기" : "홈으로 돌아가기"}><ArrowLeft className="size-4" aria-hidden="true"/><span className="hidden sm:inline">뒤로</span></Link><form onSubmit={event => { event.preventDefault(); if (Date.now() >= retryAt) void run(); }} className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-slate-200/70 bg-white/90 py-2 pl-4 pr-2 shadow-[0_5px_25px_-15px_#8b9dbc]"><label className="flex min-w-0 flex-1 items-center gap-3"><Search className="size-4 shrink-0 text-[#8b9dbc]" aria-hidden="true"/><span className="sr-only">통합 검색어</span><input className="min-h-9 min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-slate-400 sm:text-base" value={query} maxLength={500} onChange={event => { const value = event.target.value; setQuery(value); if (!value.trim()) router.replace(backHref); }} placeholder="내 자료에서 무엇이든 찾아보세요" /></label><button className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#7894c2] text-white transition-colors hover:bg-[#6282b5] disabled:opacity-40" aria-label="검색" disabled={busy || !query.trim() || retryAt > 0}><ArrowRight className="size-4" aria-hidden="true"/></button></form></section>
      <div className="flex flex-wrap gap-2" role="group" aria-label="검색 출처 필터">{[["", "전체"], ...workspaceSources.map(entry => [entry.value, entry.label])].map(([value, label]) => <button key={value} aria-label={label} onClick={() => setSource(value)} aria-pressed={source === value} className={`flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-xs ${source === value ? "border-[#cfddf6] bg-[#eaf1ff] text-[#4c71ad]" : "border-slate-200/70 bg-white/80 text-slate-500 hover:bg-white"}`}>{value && <SourceBadge source={value} iconOnly/>}{label}</button>)}</div>
    </>}
    {!actions && query.trim() && <details className="rounded-2xl border border-slate-200/70 bg-white/65 p-4"><summary className="cursor-pointer text-xs text-slate-500"><SlidersHorizontal className="mr-2 inline size-3.5" aria-hidden="true"/>상세 검색 옵션{format || from || to || semantic ? " · 적용 중" : ""}</summary><div className="mt-4 grid items-start gap-3 sm:grid-cols-[1fr_2fr]">
      <label className="text-sm">형식<select className="field mt-1" value={format} onChange={e => setFormat(e.target.value)}><option value="">모든 형식</option>{Object.entries(formatLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <details className="rounded-xl border bg-surface p-3"><summary className="cursor-pointer text-sm">원본 날짜{from || to ? ` · ${from || "전체"} ~ ${to || "전체"}` : " · 모든 기간"}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">원본 날짜 시작<input type="date" className="field mt-1" value={from} onChange={e=>setFrom(e.target.value)} /></label><label className="text-sm">원본 날짜 종료<input type="date" className="field mt-1" value={to} onChange={e=>setTo(e.target.value)} /></label></div></details>
    </div><div className="mt-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={semantic} onChange={e=>setSemantic(e.target.checked)} />의미 기반 검색 함께 사용</label><p className="meta mt-1">사용하면 검색어가 Gemini로 전송될 수 있습니다. 민감한 내용은 입력하지 마세요.</p></div></details>}
    {actions && !today && <div className="flex flex-wrap gap-2 border-b pb-5" role="group" aria-label="진행 중인 할 일 필터">{[["all","전체"],["required","해야 할 일"],["optional","신청·선택"],["review","확인 필요"],["completed","완료"]].map(([v,l])=><button key={v} className={`min-h-9 rounded-full px-3.5 py-1.5 text-sm ${tab===v ? "bg-ink text-white" : "text-muted-foreground hover:bg-brand-soft"}`} aria-pressed={tab===v} onClick={()=>setTab(v)}>{l}</button>)}</div>}
    {!actions && page && !busy && !error && <GroundedAnswer key={JSON.stringify([query,source,format,from,to,semantic,includePromotional])} query={query} filters={{ source: source ? [source] : [], format: format ? [format] : [], from: from || null, to: to || null, ...(promotionalEnabled ? { includePromotional } : {}) }} semantic={semantic}/>}
    <div aria-live="polite" className="space-y-4">
      {busy && <WorkspaceSkeleton rows={3}/>}
      {error && <div role="alert" className="panel space-y-3"><p className="text-destructive">{error}</p><button className="btn-secondary" disabled={busy || retryAt > 0} onClick={()=>void run(failedCursor.current)}>다시 시도</button>{error.includes("로그인") && <Link className="ml-3 text-sm underline" href="/login">로그인</Link>}</div>}
      {page && <><p className="meta">{page.mode === "hybrid" ? "키워드 + 의미 검색" : page.mode === "action_sql" ? "저장된 할 일 조회" : "키워드 검색"} · {page.appliedFilters?.dateBasis === "action_deadline" ? "행동 마감일 기준" : "원본 날짜 기준"}</p>{page.degraded && <p role="status" className="rounded-xl border border-amber/30 bg-amber-soft p-4 text-sm text-amber">의미 검색을 사용할 수 없어 키워드 결과를 표시합니다.</p>}{page.warning && <p role="status" className="text-sm">{page.warning === "YEAR_REQUIRED" ? "연도가 없는 날짜입니다. 날짜 필터에서 연도를 지정해 주세요." : "문서 검색에 행동 마감일 필터는 적용되지 않았습니다."}</p>}
      {!visible.length && !busy && <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-10 text-center">{!actions && <h1 className="mb-4 break-words text-xl font-semibold">{query}</h1>}<h3>{actions ? "표시할 할 일이 없습니다" : "일치하는 자료를 찾지 못했어요"}</h3><p className="mt-2 text-muted-foreground">{actions ? "자료에서 행동과 근거가 확인되면 여기에 표시됩니다." : "검색어를 바꾸거나 필터 범위를 넓혀 보세요."}</p></div>}
      {!actions && visible.length > 0 ? <SearchDemoResults page={page} query={query} now={now}/> : today ? <><div className="list-surface">{sorted.filter(r=>r.kind==="action" && r.status!=="completed" && r.deadlineStatus==="confirmed").slice(0,3).map(r=>r.kind==="action" && <ActionCard key={r.actionId} action={r} compact={today}/>)}</div><h3 className="pt-6">확인 필요 · 날짜 미정</h3><div className="list-surface">{sorted.filter(r=>r.kind==="action" && r.status!=="completed" && r.deadlineStatus!=="confirmed").slice(0,3).map(r=>r.kind==="action" && <ActionCard key={r.actionId} action={r} compact={today}/>)}</div></> : <div className={actions ? "space-y-3.5" : "list-surface"}>{visible.map(r=>r.kind==="action"?<ActionCard key={r.actionId} action={r} compact={today}/>:<SearchResultCard key={r.itemId} result={r}/>)}</div>}
      {page.nextCursor && <button className="btn-secondary w-full" disabled={busy || retryAt>0} onClick={()=>void run(page.nextCursor)}>더 불러오기</button>}{page.truncated && <p className="meta">최대 200개 결과입니다. 검색 범위를 좁혀 주세요.</p>}</>}
      {!page && !busy && !error && !actions && query.trim() && <p className="text-xs text-slate-400">검색 결과를 준비하고 있습니다.</p>}
    </div>
  </div>;
}
