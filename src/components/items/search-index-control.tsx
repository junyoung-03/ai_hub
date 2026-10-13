"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Resume the existing owner-scoped index endpoint without re-running analysis. */
export function SearchIndexControl({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function prepare() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/items/${itemId}/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
      if (!response.ok) throw new Error();
      const result: { state?: string } = await response.json();
      setMessage(result.state === "complete" ? "검색 준비가 완료되었습니다." : result.state === "pending" ? "일부 색인이 저장되었습니다. 계속하려면 다시 눌러 주세요." : "검색 준비가 아직 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      router.refresh();
    } catch { setMessage("검색 준비를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <section className="insight-section"><h3>검색 준비</h3><p className="meta mt-2">AI 분석은 완료됐습니다. 검색 색인은 별도로 처리합니다.</p><button className="btn-secondary mt-3" disabled={busy} onClick={() => void prepare()}>{busy ? "검색 준비 중…" : "검색 준비 계속하기"}</button>{message && <p role="status" className="mt-2 text-sm">{message}</p>}</section>;
}
