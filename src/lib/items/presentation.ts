import type { Enums, Json, Tables } from "@/types/database";
import type { AnalysisEvidence, DateObservation } from "@/types/analysis";
import type { EvidenceLocator } from "@/types/items";

export type ClassificationValues = Pick<Tables<"classifications">,
  "ai_primary_topic" | "user_primary_topic" | "ai_document_type" | "user_document_type" | "ai_tags" | "user_tags">;

export function effectiveClassification(value: ClassificationValues | null) {
  const edited = value !== null && (value.user_primary_topic !== null || value.user_document_type !== null || value.user_tags !== null);
  return {
    primaryTopic: value?.user_primary_topic ?? value?.ai_primary_topic ?? null,
    documentType: value?.user_document_type ?? value?.ai_document_type ?? null,
    tags: value?.user_tags ?? value?.ai_tags ?? [],
    origin: edited ? "user" as const : "ai" as const,
    available: value !== null,
    origins: {
      primaryTopic: value?.user_primary_topic != null ? "user" : "ai",
      documentType: value?.user_document_type != null ? "user" : "ai",
      tags: value?.user_tags != null ? "user" : "ai",
    },
  };
}

function jsonRecord(value: Json | undefined) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** Rebuild every JSON layer: selecting a safe outer key must not leak nested keys. */
function locationFields(value: Json | undefined): Partial<AnalysisEvidence["locator"]> {
  const row = jsonRecord(value);
  if (!row) return {};
  const result: Partial<AnalysisEvidence["locator"]> = {};
  const kinds = ["text_span", "page", "email_section", "calendar_field", "metadata", "unknown"] as const;
  const kind = kinds.find((entry) => entry === row.kind);
  if (kind) result.kind = kind;
  for (const key of ["page", "startChar", "endChar"] as const) {
    const number = row[key];
    if (number === null || (typeof number === "number" && Number.isSafeInteger(number) && number >= (key === "page" ? 1 : 0))) result[key] = number;
  }
  for (const key of ["section", "field"] as const) {
    if (row[key] === null || typeof row[key] === "string") result[key] = row[key];
  }
  return result;
}

function storedQuote(value: Json | undefined): AnalysisEvidence | null {
  const row = jsonRecord(value);
  if (!row || typeof row.text !== "string" || !row.text.trim()) return null;
  const locator = locationFields(row.locator);
  if (locator.kind === undefined || locator.page === undefined || locator.section === undefined
    || locator.startChar === undefined || locator.endChar === undefined || locator.field === undefined) return null;
  if (locator.kind === "text_span" && (locator.startChar === null || locator.endChar === null
    || locator.endChar - locator.startChar !== Array.from(row.text).length)) return null;
  return { text: row.text, locator: { kind: locator.kind, page: locator.page, section: locator.section,
    startChar: locator.startChar, endChar: locator.endChar, field: locator.field } };
}

function storedObservation(value: Json | undefined): DateObservation | null {
  const row = jsonRecord(value);
  if (!row) return null;
  if (row.status === "none") return [row.date, row.datetime, row.rawText, row.evidence].every((entry) => entry === null)
    ? { status: "none", date: null, datetime: null, rawText: null, evidence: null } : null;
  const evidence = storedQuote(row.evidence);
  if (!evidence || typeof row.rawText !== "string" || !row.rawText.trim() || !evidence.text.includes(row.rawText)) return null;
  if (row.status === "needs_review" && row.date === null && row.datetime === null) {
    return { status: "needs_review", date: null, datetime: null, rawText: row.rawText, evidence };
  }
  if (row.status !== "confirmed" || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  const date = new Date(`${row.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date) return null;
  if (row.datetime !== null && (typeof row.datetime !== "string" || !row.datetime.startsWith(`${row.date}T`)
    || !/(Z|[+-]\d{2}:\d{2})$/.test(row.datetime) || !Number.isFinite(Date.parse(row.datetime)))) return null;
  return { status: "confirmed", date: row.date, datetime: row.datetime, rawText: row.rawText, evidence };
}

/** Only persisted Evidence is projected; no quotes or observations are generated. */
export function safeEvidenceLocator(value: Json): EvidenceLocator {
  const row = jsonRecord(value);
  const result: EvidenceLocator = locationFields(value);
  if (row?.schemaVersion !== "0.2") return result;
  result.schemaVersion = "0.2";
  if (Array.isArray(row.evidence) && row.evidence.length <= 5) {
    result.evidence = row.evidence.flatMap((entry) => {
      const quote = storedQuote(entry);
      return quote ? [quote] : [];
    });
  }
  for (const key of ["startObservation", "deadlineObservation"] as const) {
    const observation = storedObservation(row[key]);
    if (observation) result[key] = observation;
  }
  return result;
}

export const sourceLabels: Record<Enums<"item_source">, string> = {
  gmail: "Gmail", drive: "Google Drive", calendar: "Google Calendar", upload: "Upload", manual: "직접 입력",
};
export const formatLabels: Record<Enums<"item_format">, string> = {
  email: "이메일", pdf: "PDF", image: "이미지", screenshot: "스크린샷", document: "문서", text: "텍스트", calendar_event: "일정", other: "기타",
};
export const documentLabels: Record<Enums<"document_type">, string> = {
  notice: "공지", application: "신청", contract: "계약", billing: "청구", reservation: "예약", certificate: "증명", schedule: "일정", general: "일반", other: "기타",
};
export const statusLabels: Record<Enums<"processing_status">, string> = {
  uploaded: "처리 중 · 업로드됨", queued: "처리 중 · 대기", extracting: "처리 중 · 추출", analyzing: "처리 중 · 분석", indexing: "처리 중 · 색인", completed: "완료", failed: "실패",
};

export function safeOriginalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 확인 필요" : new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
  }).format(date) + " KST";
}

/** Display only locator fields, never arbitrary metadata or HTML. */
export function locatorLabels(locator: Json): string[] {
  if (locator === null || typeof locator !== "object" || Array.isArray(locator)) return [];
  const keys = { kind: "위치 유형", page: "페이지", section: "구역", startChar: "시작 문자", endChar: "끝 문자", field: "필드" };
  return Object.entries(keys).flatMap(([key, label]) => {
    const value = locator[key];
    return typeof value === "string" || typeof value === "number" ? [`${label}: ${value}`] : [];
  });
}
