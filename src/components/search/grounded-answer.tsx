"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Answer = { status: "answered" | "no_evidence"; mode: string; degraded: boolean;
  statements: { text: string; quote: string; source: number }[];
  sources: { itemId: string; title: string; detailUrl: string }[] };

export function GroundedAnswer({ query, filters, semantic }: { query: string; filters: { source: string[]; format: string[]; from: string | null; to: string | null; includePromotional?: boolean }; semantic: boolean }) {
  const [answer, setAnswer] = useState<Answer>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function run() {
    if (busy || !query.trim()) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setAnswer(undefined);
    try {
      const response = await fetch("/api/v1/search/answer", { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim(), filters, semantic }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const code = payload?.error?.code;
        throw new Error(code === "RAG_EVIDENCE_INVALID" ? "AI 답변의 원문 근거를 확인하지 못했습니다. 다시 시도해 주세요."
          : response.status === 429 ? "요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
          : response.status === 401 ? "로그인이 만료되었습니다. 다시 로그인해 주세요."
          : "AI 답변을 만들지 못했습니다. 아래 검색 결과와 원문을 확인해 주세요.");
      }
      const result = await response.json() as Answer;
      if (!controller.signal.aborted) setAnswer(result);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "AI 답변을 만들지 못했습니다.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section aria-label="원문 기반 AI 답변" className="rounded-2xl border border-blue-100 bg-white/90 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-800">원문 기반 AI 답변</h2><p className="mt-1 text-xs leading-5 text-slate-500">버튼을 누르면 검색어와 검색된 원문 일부가 Google Gemini에 전송됩니다. 민감한 내용은 입력하지 마세요.</p></div>
      <button type="button" onClick={() => void run()} disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "답변 생성 중…" : "원문으로 답변 만들기"}</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {answer && <div aria-live="polite" className="mt-4 space-y-3 text-sm text-slate-700">
      {answer.degraded && <p role="status" className="text-amber-700">의미 검색을 사용할 수 없어 키워드 검색 결과로 답변했습니다.</p>}
      {answer.status === "no_evidence" ? <p>질문에 답할 원문 근거를 찾지 못했습니다.</p> : <>
        {answer.statements.map((statement, index) => <div key={index} className="rounded-xl bg-slate-50 p-3"><p>{statement.text} <Link className="text-blue-600 underline" href={answer.sources[statement.source - 1].detailUrl}>[{statement.source}] {answer.sources[statement.source - 1].title}</Link></p><p className="mt-2 text-xs text-slate-500">원문: “{statement.quote}”</p></div>)}
        <p className="text-xs text-slate-500">AI 답변은 오류가 있을 수 있습니다. 연결된 원문을 확인해 주세요.</p>
      </>}
    </div>}
  </section>;
}
