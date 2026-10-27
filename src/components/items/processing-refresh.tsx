"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProcessingSnapshot } from "@/lib/items/processing";
import { PROCESSING_POLL_LIMIT, processingSnapshotKey, startProcessingPolling } from "@/lib/items/processing-poller";

export function ProcessingRefresh({ items }: { items: ProcessingSnapshot[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ snapshot: string; attempt: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const budget = useRef({ attempt: -1, deadline: 0, ids: [] as string[], active: false });
  const active = items.filter(item => item.processing.canPoll);
  const snapshot = processingSnapshotKey(active);
  const ids = active.map(item => item.id).sort().join(",");
  const message = notice?.snapshot === snapshot && notice.attempt === attempt ? notice.message : "";
  useEffect(() => {
    if (!ids) { budget.current.active = false; return; }
    const currentIds = ids.split(",");
    if (!budget.current.active || budget.current.attempt !== attempt || currentIds.some(id => !budget.current.ids.includes(id))) {
      budget.current.deadline = Date.now() + PROCESSING_POLL_LIMIT;
    }
    budget.current = { ...budget.current, attempt, ids: currentIds, active: true };
    return startProcessingPolling({
      initial: JSON.parse(snapshot) as ProcessingSnapshot[], deadline: budget.current.deadline,
      read: async signal => {
        const response = await fetch(`/api/v1/items/processing?${new URLSearchParams({ ids })}`, { cache: "no-store", signal });
        if (!response.ok) throw new Error("STATUS_READ_FAILED");
        const data = await response.json() as { items?: ProcessingSnapshot[] };
        if (!Array.isArray(data.items) || data.items.some(item => !item || typeof item.id !== "string" || !ids.split(",").includes(item.id) || !item.processing || typeof item.processing.canPoll !== "boolean")) throw new Error("INVALID_STATUS_RESPONSE");
        return data.items;
      },
      onChange: () => router.refresh(),
      onStop: reason => { if (reason !== "settled") setNotice({ snapshot, attempt, message: reason === "limit" ? "자동 상태 확인을 마쳤습니다. 처리가 끝나지 않았다면 새로고침해 확인해 주세요." : "처리 상태를 불러오지 못했습니다. 새로고침해 다시 확인해 주세요." }); },
      isVisible: () => document.visibilityState === "visible",
      subscribeVisibility: callback => { document.addEventListener("visibilitychange", callback); return () => document.removeEventListener("visibilitychange", callback); },
    });
  }, [ids, snapshot, attempt, router]);
  if (!ids) return null;
  return <p role="status" className="my-3 text-xs text-slate-500">{message || "처리 상태를 자동으로 확인하고 있습니다."}{message && <button type="button" className="ml-2 underline" onClick={() => { setNotice(null); setAttempt(value => value + 1); router.refresh(); }}>새로고침</button>}</p>;
}
