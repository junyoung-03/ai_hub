"use client";
import { useCallback, useEffect, useState } from "react";
import type { ItemList } from "@/lib/items/queries";
import type { ItemDetailResponse, ItemScheduleDetail, ItemSchedulePage } from "@/types/items";
import type { SearchActionResult } from "@/types/search-ui";
import { readWorkspaceJson as readJson } from "./workspace-request";

export type LibraryItem = ItemList["items"][number];
export function useActions(status: "open" | "completed" = "open") {
  const [rows, setRows] = useState<SearchActionResult[]>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      setBusy(true); setError("");
      try {
        const results: SearchActionResult[] = []; let cursor: string | null = null;
        const seen = new Set<string>();
        do {
          const params = new URLSearchParams({status,limit:"50"}); if (cursor) params.set("cursor",cursor);
          const page = await readJson<{results:SearchActionResult[];nextCursor:string|null}>(`/api/v1/actions?${params}`,controller.signal);
          results.push(...page.results); cursor = page.nextCursor;
          if (cursor && seen.has(cursor)) throw new Error("목록을 다시 불러와 주세요.");
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (!controller.signal.aborted) setRows(results);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "할 일을 불러오지 못했습니다."); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void run(); return () => controller.abort();
  }, [status,version]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("ai-hub:actions-changed", reload);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("ai-hub:actions-changed", reload); window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", visible); };
  }, [reload]);
  return {rows,busy,error,reload};
}
export function useItemDetails(items: LibraryItem[]) {
  const [details,setDetails] = useState<Record<string,ItemDetailResponse>>({});
  const [busy,setBusy] = useState(items.length > 0), [error,setError] = useState("");
  const [version,setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      setBusy(items.length > 0); setError("");
      // Keep successfully loaded entries visible during an explicit retry.
      const currentIds = new Set(items.map(item => item.id));
      setDetails(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => currentIds.has(id))));
      let index = 0, failed = false;
      await Promise.all(Array.from({length:Math.min(3,items.length)}, async () => {
        while (index < items.length && !controller.signal.aborted) {
          const item = items[index++];
          try {
            const detail = await readJson<ItemDetailResponse>(`/api/v1/items/${item.id}`,controller.signal);
            if (!controller.signal.aborted) setDetails(previous=>({...previous,[item.id]:detail}));
          } catch { if (!controller.signal.aborted) failed = true; }
        }
      }));
      if (!controller.signal.aborted) { setBusy(false); if (failed) setError("일부 자료의 상세 정보를 불러오지 못했습니다. 다시 확인해 주세요."); }
    }
    void run(); return () => controller.abort();
  }, [items,version]);
  return {details,busy:busy || (!error && items.some(item=>!details[item.id])),error,reload};
}
export function useScheduleItems(enabled = true) {
  const [details,setDetails] = useState<Record<string,ItemScheduleDetail>>({});
  const [busy,setBusy] = useState(enabled), [error,setError] = useState("");
  const [cursor,setCursor] = useState<string|null>(null), [requestCursor,setRequestCursor] = useState<string|null>(null);
  const [version,setVersion] = useState(0);
  const reload = useCallback(()=>{setRequestCursor(null);setVersion(value=>value+1);},[]);
  useEffect(() => {
    window.addEventListener("ai-hub:items-changed", reload);
    return () => window.removeEventListener("ai-hub:items-changed", reload);
  }, [reload]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function run() {
      setBusy(true); setError("");
      try {
        // The schedule projection includes protected dates regardless of promotional visibility.
        const params = new URLSearchParams({limit:"100"}); if(requestCursor)params.set("cursor",requestCursor);
        const page = await readJson<ItemSchedulePage>(`/api/v1/items/schedule?${params}`,controller.signal);
        if (!controller.signal.aborted) {
          const loaded = Object.fromEntries(page.items.map(detail => [detail.item.id, detail]));
          setDetails(previous => requestCursor ? { ...previous, ...loaded } : loaded);
          setCursor(page.nextCursor);
        }
      } catch (failure) { if(!controller.signal.aborted)setError(failure instanceof Error ? failure.message : "일정을 불러오지 못했습니다."); }
      finally { if(!controller.signal.aborted)setBusy(false); }
    }
    void run(); return ()=>controller.abort();
  }, [enabled,requestCursor,version]);
  return {items:Object.values(details).map(detail => detail.item),details,busy:enabled && busy,error,hasMore:!!cursor,
    loadMore:()=>setRequestCursor(cursor),reload};
}
