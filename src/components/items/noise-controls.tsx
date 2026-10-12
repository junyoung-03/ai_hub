"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NoiseOverride, NoiseState } from "@/lib/items/noise";

export function NoiseControls({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [state, setState] = useState<NoiseState | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/items/${itemId}/noise-override`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<NoiseState>; })
      .then(setState).catch(() => { if (!controller.signal.aborted) setError("광고 판단을 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [itemId]);
  async function save(userOverride: NoiseOverride) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/items/${itemId}/noise-override`, { method: "PATCH", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userOverride }) });
      if (!response.ok) throw new Error();
      setState(await response.json() as NoiseState);
      window.dispatchEvent(new Event("ai-hub:items-changed"));
      router.refresh();
    } catch { setError("광고 판단을 저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  const status = state?.userOverride === "force_show" ? "항상 표시 중" : state?.userOverride === "force_promotional" ? "광고로 숨김"
    : state?.aiVerdict === "promotional" ? state.effectiveVisibility === "SHOW" ? "광고로 판단됨 · 중요 정보 보호로 표시" : "광고로 판단됨"
    : "자동 판단";
  return <details className="border-t pt-4"><summary className="cursor-pointer text-sm">광고 판단{state ? ` · ${status}` : ""}</summary>
    <p className="mt-3 text-sm text-slate-600">광고로 지정해도 원본과 할 일·일정은 유지됩니다.</p>
    <div className="mt-3 flex flex-wrap gap-2">{([["force_show", "항상 표시"], ["force_promotional", "광고로 숨기기"], [null, "자동 판단 사용"]] as const).map(([value, label]) =>
      <button key={label} disabled={busy || !state} aria-pressed={state?.userOverride === value} onClick={() => void save(value)} className="btn-secondary">{label}</button>)}</div>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </details>;
}
