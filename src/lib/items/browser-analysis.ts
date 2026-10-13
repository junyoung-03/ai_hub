/** Separate bounded requests after collection/upload commits. No detached background work. */
export async function runBoundedAnalysis(ids: string[], onProgress?: (message: string) => void, signal?: AbortSignal) {
  const unique = [...new Set(ids)].slice(0, 3); let complete = 0, failed = 0, skipped = 0, queued = 0;
  for (const [index, id] of unique.entries()) {
    if (signal?.aborted) { skipped += unique.length - index; break; }
    onProgress?.(`AI 분석 중 ${index + 1}/${unique.length}`);
    try {
      const response = await fetch(`/api/v1/items/${id}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal });
      if (!response.ok) { failed++; continue; }
      if (response.status === 202) { queued++; continue; }
      complete++;
    } catch { failed++; }
  }
  const pending = Math.max(0, new Set(ids).size - unique.length) + skipped;
  const message = unique.length ? `AI 분석 완료 ${complete} · 실패 ${failed}${queued ? ` · 백그라운드 처리 요청 ${queued}` : ""}${pending ? ` · 대기 ${pending}` : ""}${failed ? " · 자료는 저장되어 있습니다. 상세에서 재시도하세요." : ""}` : "현재 분석할 자료가 없습니다.";
  onProgress?.(message); return { complete, failed, pending, queued, message };
}
