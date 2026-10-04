import type { Enums, Json, Tables } from "@/types/database";

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
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(date) + " UTC";
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
