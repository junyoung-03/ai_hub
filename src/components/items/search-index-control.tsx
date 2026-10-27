"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readIndexProgress } from "@/lib/search/index-progress";

/** Resume the existing owner-scoped index endpoint without re-running analysis. */
export function SearchIndexControl({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [retry, setRetry] = useState(false), [retryAt, setRetryAt] = useState(0);
  const running = useRef(false);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => setRetryAt(0), Math.min(2_147_483_647, Math.max(0, retryAt - Date.now())));
    return () => clearTimeout(timer);
  }, [retryAt]);
  async function prepare() {
    if (running.current || retryAt > Date.now()) return;
    running.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/items/${itemId}/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(retry ? { retry: true } : {}), cache: "no-store" });
      const result = await readIndexProgress(response);
      setMessage(result.message);
      setRetry(result.canRetry || (retry && result.state === "waiting"));
      setRetryAt(result.retryAt > Date.now() ? result.retryAt : 0);
      router.refresh();
    } catch { setMessage("검색 준비를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { running.current = false; setBusy(false); }
  }
  return <section className="insight-section"><h3>검색 준비</h3><p className="meta mt-2">AI 분석은 완료됐습니다. 검색 색인은 별도로 처리합니다.</p><button className="btn-secondary mt-3" disabled={busy || retryAt !== 0} onClick={() => void prepare()}>{busy ? "검색 준비 중…" : retry ? "검색 준비 다시 시도" : "검색 준비 계속하기"}</button>{message && <p role="status" className="mt-2 text-sm">{message}</p>}</section>;
}
