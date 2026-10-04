import "server-only";

import { createHash } from "node:crypto";
import { Constants, type Enums } from "@/types/database";

export class InvalidItemQueryError extends Error {
  constructor() { super("필터 또는 페이지 주소가 올바르지 않습니다. 필터를 확인해 주세요."); }
}

export type ItemFilters = {
  source?: Enums<"item_source">;
  format?: Enums<"item_format">;
  topic?: string;
  documentType?: Enums<"document_type">;
  processingStatus?: Enums<"processing_status">;
  from?: string;
  to?: string;
};
type Position = { createdAt: string; id: string };
export type ItemQuery = { filters: ItemFilters; limit: number; position?: Position; queryKey: string };
export const isItemId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidItemQueryError();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new InvalidItemQueryError();
  return value;
}
function enumValue<T extends string>(value: string, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new InvalidItemQueryError();
  return value as T;
}

export function parseItemQuery(params: URLSearchParams): ItemQuery {
  const allowed = ["source", "format", "topic", "documentType", "processingStatus", "from", "to", "cursor", "limit"];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new InvalidItemQueryError();
  }
  const filters: ItemFilters = {};
  const enums = Constants.public.Enums;
  const source = params.get("source");
  const format = params.get("format");
  const doc = params.get("documentType");
  const status = params.get("processingStatus");
  const topic = params.get("topic");
  if (source) filters.source = enumValue(source, enums.item_source);
  if (format) filters.format = enumValue(format, enums.item_format);
  if (doc) filters.documentType = enumValue(doc, enums.document_type);
  if (status) filters.processingStatus = enumValue(status, enums.processing_status);
  if (topic) {
    if (topic.length > 1024 || /[\u0000-\u001f\u007f]/.test(topic)) throw new InvalidItemQueryError();
    filters.topic = topic;
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from) filters.from = date(from);
  if (to) filters.to = date(to);
  if (filters.from && filters.to && filters.from > filters.to) throw new InvalidItemQueryError();
  const size = params.get("limit");
  if (size !== null && !/^[1-9]\d{0,2}$/.test(size)) throw new InvalidItemQueryError();
  const limit = size === null ? 30 : Number(size);
  if (limit > 100) throw new InvalidItemQueryError();
  const queryKey = createHash("sha256").update(JSON.stringify({ filters, limit })).digest("hex");
  let position: Position | undefined;
  const cursor = params.get("cursor");
  if (cursor !== null) {
    try {
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error();
      const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!value || typeof value !== "object" || !("v" in value) || value.v !== 1 || !("queryKey" in value) || value.queryKey !== queryKey || !("id" in value) || typeof value.id !== "string" || !isItemId(value.id) || !("createdAt" in value) || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error();
      position = { id: value.id, createdAt: value.createdAt };
    } catch { throw new InvalidItemQueryError(); }
  }
  return { filters, limit, position, queryKey };
}

export function encodeCursor(position: Position, query: ItemQuery) {
  // Cursor is a position, not an authorization credential. Preserve PG microseconds.
  return Buffer.from(JSON.stringify({ v: 1, ...position, queryKey: query.queryKey })).toString("base64url");
}

export function libraryUrl(query: ItemQuery, cursor?: string) {
  const params = new URLSearchParams(query.filters);
  if (query.limit !== 30) params.set("limit", String(query.limit));
  if (cursor) params.set("cursor", cursor);
  return `/library${params.size ? `?${params}` : ""}`;
}

/** PostgREST quoted values escape grammar delimiters, quotes and backslashes. */
export function filterLiteral(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
