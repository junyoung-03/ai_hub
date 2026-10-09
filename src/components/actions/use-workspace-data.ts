"use client";
import { useCallback, useEffect, useState } from "react";
import type { ItemList } from "@/lib/items/queries";
import type { ItemDetailResponse } from "@/types/items";
import type { SearchActionResult } from "@/types/search-ui";

export type LibraryItem = ItemList["items"][number];
async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {cache:"no-store",signal});
  if (!response.ok) throw new Error(response.status === 401 ? "로그인이 만료되었습니다. 다시 로그인해 주세요." : "자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return response.json() as Promise<T>;
}
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
  useEffect(() => { window.addEventListener("ai-hub:actions-changed",reload); return () => window.removeEventListener("ai-hub:actions-changed",reload); }, [reload]);
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
      setBusy(items.length > 0); setError(""); setDetails({});
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
  const [items,setItems] = useState<LibraryItem[]>([]);
  const [busy,setBusy] = useState(enabled), [error,setError] = useState("");
  const [cursor,setCursor] = useState<string|null>(null), [requestCursor,setRequestCursor] = useState<string|null>(null);
  const [version,setVersion] = useState(0);
  const reload = useCallback(()=>{setRequestCursor(null);setVersion(value=>value+1);},[]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function run() {
      setBusy(true); setError("");
      try {
        const params = new URLSearchParams({limit:"100"}); if(requestCursor)params.set("cursor",requestCursor);
        const page = await readJson<ItemList>(`/api/v1/items?${params}`,controller.signal);
        if (!controller.signal.aborted) { setItems(previous=>requestCursor ? [...previous,...page.items] : page.items);setCursor(page.nextCursor); }
      } catch (failure) { if(!controller.signal.aborted)setError(failure instanceof Error ? failure.message : "일정을 불러오지 못했습니다."); }
      finally { if(!controller.signal.aborted)setBusy(false); }
    }
    void run(); return ()=>controller.abort();
  }, [enabled,requestCursor,version]);
  const detail = useItemDetails(items);
  return {items,details:detail.details,busy:busy || detail.busy,error:error || detail.error,hasMore:!!cursor,
    loadMore:()=>setRequestCursor(cursor),reload:()=>{reload();detail.reload();}};
}
