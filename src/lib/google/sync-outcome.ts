export type CollectionService = "gmail" | "drive" | "calendar";
export type CollectionOutcome = {
  kind: "complete" | "partial" | "failed";
  label: string;
  text: string;
  lastSyncedAt: string | null;
  analysisItemIds: string[];
  analysisDiscoveryFailed: boolean;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const validCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const names = { gmail: "Gmail", drive: "Drive", calendar: "Calendar" };
const reasons: Record<string, string> = {
  FILE_LIMIT: "파일 수 제한", EVENT_LIMIT: "일정 수 제한", PAGE_LIMIT: "페이지 수 제한",
  RUN_BYTES_LIMIT: "본문 용량 제한", RUN_TIMEOUT: "수집 시간 초과", LIST_FAILED: "목록 조회 실패",
};

/** A successful HTTP response can still contain a partial or failed collection. */
export function collectionOutcome(service: CollectionService, value: unknown): CollectionOutcome {
  const result = record(value);
  const keys = service === "gmail" ? ["created_count", "updated_count", "skipped_count", "failed_count"]
    : ["created", "updated", "reused", "failed"];
  if (!result || !keys.every(key => validCount(result[key]))) {
    return { kind: "failed", label: "수집 결과 확인 실패", text: `${names[service]}: 수집 결과를 확인하지 못했습니다.`,
      lastSyncedAt: null, analysisItemIds: [], analysisDiscoveryFailed: false };
  }
  const created = count(result[keys[0]]), updated = count(result[keys[1]]), reused = count(result[keys[2]]);
  const failed = count(result[keys[3]]), unprocessed = count(result.unprocessed);
  const skipped = service === "calendar" ? count(result.skipped) : service === "drive" ? count(result.excluded) : 0;
  const stored = created + updated + reused;
  const stopReason = typeof result.stopReason === "string" && result.stopReason ? result.stopReason : null;
  const incomplete = failed > 0 || unprocessed > 0 || !!stopReason || result.complete === false
    || result.capped === true || (service !== "gmail" && result.complete !== true);
  const kind = !incomplete ? "complete" : stored > 0 || skipped > 0 ? "partial" : "failed";
  const label = kind === "complete" ? "이번 수집 완료" : kind === "partial" ? "일부 수집" : "수집 실패";
  const details = [`신규 ${created}건`, `갱신 ${updated}건`, `기존 ${reused}건`];
  if (skipped) details.push(`${service === "drive" ? "제외" : "건너뜀"} ${skipped}건`);
  if (failed) details.push(`실패 ${failed}건`);
  if (unprocessed) details.push(`미처리 ${unprocessed}건`);
  if (stopReason) details.push(reasons[stopReason] ?? "수집 중단");
  if (result.capped === true) details.push(service === "gmail" ? "최대 100건 범위 · 추가 메일 있음" : "수집 범위 제한");
  const discoveryFailed = result.analysisDiscoveryFailed === true;
  if (discoveryFailed) details.push("후속 AI 대상 확인 실패 · 수집 자료는 유지됩니다");
  const serverTime = result.lastSyncedAt ?? result.last_synced_at;
  return {
    kind, label, text: `${names[service]}: ${label} · ${details.join(" · ")}`,
    lastSyncedAt: kind === "complete" && typeof serverTime === "string" && Number.isFinite(Date.parse(serverTime)) ? serverTime : null,
    analysisItemIds: service !== "calendar" && Array.isArray(result.analysisItemIds)
      ? [...new Set(result.analysisItemIds.filter((id): id is string => typeof id === "string" && !!id.trim()))] : [],
    analysisDiscoveryFailed: discoveryFailed,
  };
}

/** Keep the last server-confirmed success; never manufacture a browser timestamp. */
export function latestSyncTimestamp(previous: string | null | undefined, server: string | null | undefined): string | null {
  const valid = (value: string | null | undefined): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (!valid(server)) return valid(previous) ? previous : null;
  return valid(previous) && Date.parse(previous) > Date.parse(server) ? previous : server;
}
