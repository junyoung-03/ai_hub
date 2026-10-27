/** Safe UI projection shared by manual creation and explicit index resumption. */
export type IndexProgress = {
  state: "complete" | "pending" | "failed" | "waiting" | "stale" | "skipped" | "error";
  message: string;
  canRetry: boolean;
  retryAt: number;
};

function retryTime(value: unknown, now: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return now + Math.max(0, value) * 1000;
  if (typeof value !== "string") return 0;
  if (/^\d+$/.test(value)) return now + Number(value) * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export async function readIndexProgress(response: Response, now = Date.now()): Promise<IndexProgress> {
  const body: unknown = await response.json().catch(() => null);
  const result: Record<string, unknown> = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const retryAt = Math.max(retryTime(response.headers.get("Retry-After"), now), retryTime(result.retryAfter, now));
  const base = { canRetry: false, retryAt };
  if (!response.ok) {
    const error = result.error;
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (response.status === 429 || code === "INDEX_BUSY") return { ...base, retryAt: Math.max(retryAt, now + (response.status === 429 ? 60_000 : 5_000)), state: "waiting", message: "요청이 많거나 다른 작업이 진행 중입니다. 잠시 후 검색 준비를 계속해 주세요." };
    if (code === "STALE_INPUT") return { ...base, state: "stale", message: "처리 중 자료가 변경되었습니다. 최신 상태를 확인한 뒤 검색 준비를 계속해 주세요." };
    if (response.status === 401) return { ...base, state: "error", message: "로그인이 필요합니다. 자료는 저장되어 있습니다." };
    return { ...base, state: "error", canRetry: response.status >= 500, message: "검색 준비에 실패했습니다. 자료와 AI 분석은 저장되어 있습니다. 상세에서 재시도해 주세요." };
  }
  if (result.state === "complete") return { ...base, state: "complete", message: "검색 준비가 완료되었습니다." };
  if (result.state === "pending") return { ...base, state: "pending", message: "검색 준비가 일부 완료되었습니다. 상세에서 이어서 처리할 수 있습니다." };
  if (result.state === "failed") return { ...base, state: "failed", canRetry: true, message: "검색 준비가 중단되었습니다. 대기 시간이 지난 뒤 다시 시도해 주세요." };
  if (result.state === "skipped_limit") return { ...base, state: "skipped", message: "자료 크기가 검색 준비의 처리 한도를 초과했습니다. 자료와 AI 분석 결과는 유지됩니다." };
  return { ...base, state: "error", message: "검색 준비 완료를 확인하지 못했습니다. 상세에서 상태를 확인해 주세요." };
}
