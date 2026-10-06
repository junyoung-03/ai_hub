"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import { ActionCard, SearchResultCard } from "./search-results";
import type { SearchPageResponse } from "@/types/search-ui";
import { sourceLabels, formatLabels } from "@/lib/items/presentation";

export function SearchWorkspace({ initialQuery = "", actions = false, today = false }: { initialQuery?: string; actions?: boolean; today?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState(""); const [format, setFormat] = useState("");
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
        ...(directActions ? {} : { body: JSON.stringify({ query: query.trim(), filters: { source: source ? [source] : [], format: format ? [format] : [], from: from || null, to: to || null }, limit: 20, semantic, cursor }) }) });
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
  }, [query, source, format, from, to, semantic, actions, today, tab]);
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
    {!actions && <section className="search-surface border-b border-line pb-4"><form onSubmit={event => { event.preventDefault(); if (Date.now() >= retryAt) void run(); }} className="flex items-center gap-3"><label className="flex min-w-0 flex-1 items-center gap-3"><Search className="size-5 shrink-0 text-faint" aria-hidden="true"/><span className="sr-only">통합 검색어</span><input className="min-h-12 w-full bg-transparent text-lg outline-none placeholder:text-faint sm:text-xl" value={query} maxLength={500} onChange={event => setQuery(event.target.value)} placeholder="어떤 자료를 찾고 있나요?" /></label><button className="btn-primary" disabled={busy || !query.trim() || retryAt > 0}>검색</button></form><p className="mt-3 text-sm text-muted-foreground">메일, 문서, 일정과 이미지 속 내용까지. 검색 결과의 원문 근거를 함께 확인하세요.</p></section>}
    {!actions && <div className="grid grid-cols-2 items-start gap-3 lg:grid-cols-[1fr_1fr_2fr]">
      <label className="text-sm">출처<select className="field mt-1" value={source} onChange={e => setSource(e.target.value)}><option value="">모든 출처</option>{Object.entries(sourceLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm">형식<select className="field mt-1" value={format} onChange={e => setFormat(e.target.value)}><option value="">모든 형식</option>{Object.entries(formatLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <details className="col-span-2 rounded-xl border bg-surface p-3 lg:col-span-1"><summary className="cursor-pointer text-sm">원본 날짜{from || to ? ` · ${from || "전체"} ~ ${to || "전체"}` : " · 모든 기간"}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">원본 날짜 시작<input type="date" className="field mt-1" value={from} onChange={e=>setFrom(e.target.value)} /></label><label className="text-sm">원본 날짜 종료<input type="date" className="field mt-1" value={to} onChange={e=>setTo(e.target.value)} /></label></div></details>
    </div>}
    {!actions && <div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={semantic} onChange={e=>setSemantic(e.target.checked)} />의미 기반 검색 함께 사용</label><p className="meta mt-1">사용하면 검색어가 Gemini로 전송될 수 있습니다. 민감한 내용은 입력하지 마세요.</p></div>}
    {actions && !today && <div className="flex flex-wrap gap-2 border-b pb-5" role="group" aria-label="진행 중인 할 일 필터">{[["all","전체"],["required","해야 할 일"],["optional","신청·선택"],["review","확인 필요"],["completed","완료"]].map(([v,l])=><button key={v} className={`min-h-9 rounded-full px-3.5 py-1.5 text-sm ${tab===v ? "bg-ink text-white" : "text-muted-foreground hover:bg-brand-soft"}`} aria-pressed={tab===v} onClick={()=>setTab(v)}>{l}</button>)}</div>}
    <div aria-live="polite" className="space-y-4">
      {busy && <div role="status" className="panel"><p className="text-muted-foreground">{actions ? "할 일을 불러오는 중…" : "검색 결과를 찾는 중…"}</p><div className="mt-4 h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse" /></div>}
      {error && <div role="alert" className="panel space-y-3"><p className="text-destructive">{error}</p><button className="btn-secondary" disabled={busy || retryAt > 0} onClick={()=>void run(failedCursor.current)}>다시 시도</button>{error.includes("로그인") && <Link className="ml-3 text-sm underline" href="/login">로그인</Link>}</div>}
      {page && <><p className="meta">{page.mode === "hybrid" ? "키워드 + 의미 검색" : page.mode === "action_sql" ? "저장된 할 일 조회" : "키워드 검색"} · {page.appliedFilters?.dateBasis === "action_deadline" ? "행동 마감일 기준" : "원본 날짜 기준"}</p>{page.degraded && <p role="status" className="rounded-xl border border-amber/30 bg-amber-soft p-4 text-sm text-amber">의미 검색을 사용할 수 없어 키워드 결과를 표시합니다.</p>}{page.warning && <p role="status" className="text-sm">{page.warning === "YEAR_REQUIRED" ? "연도가 없는 날짜입니다. 날짜 필터에서 연도를 지정해 주세요." : "문서 검색에 행동 마감일 필터는 적용되지 않았습니다."}</p>}
      {!visible.length && !busy && <div className="panel py-10 text-center"><h3>{actions ? "표시할 할 일이 없습니다" : "일치하는 자료를 찾지 못했어요"}</h3><p className="mt-2 text-muted-foreground">{actions ? "자료에서 행동과 근거가 확인되면 여기에 표시됩니다." : "검색어를 바꾸거나 필터 범위를 넓혀 보세요."}</p></div>}
      {today ? <><div className="list-surface">{sorted.filter(r=>r.kind==="action" && r.status!=="completed" && r.deadlineStatus==="confirmed").slice(0,3).map(r=>r.kind==="action" && <ActionCard key={r.actionId} action={r} compact={today}/>)}</div><h3 className="pt-6">확인 필요 · 날짜 미정</h3><div className="list-surface">{sorted.filter(r=>r.kind==="action" && r.status!=="completed" && r.deadlineStatus!=="confirmed").slice(0,3).map(r=>r.kind==="action" && <ActionCard key={r.actionId} action={r} compact={today}/>)}</div></> : <div className={actions ? "space-y-3.5" : "list-surface"}>{visible.map(r=>r.kind==="action"?<ActionCard key={r.actionId} action={r} compact={today}/>:<SearchResultCard key={r.itemId} result={r}/>)}</div>}
      {page.nextCursor && <button className="btn-secondary w-full" disabled={busy || retryAt>0} onClick={()=>void run(page.nextCursor)}>더 불러오기</button>}{page.truncated && <p className="meta">최대 200개 결과입니다. 검색 범위를 좁혀 주세요.</p>}</>}
      {!page && !busy && !error && !actions && <div className="panel py-10"><h2>기억나는 내용으로 찾아보세요</h2><p className="mt-2 text-muted-foreground">정확한 제목을 몰라도 괜찮아요.</p><div className="mt-5 flex flex-wrap gap-3">{["이번 주 제출", "해야 할 일"].map(q=><button key={q} className="btn-secondary" onClick={()=>setQuery(q)}>{q} →</button>)}</div></div>}
    </div>
  </div>;
}
