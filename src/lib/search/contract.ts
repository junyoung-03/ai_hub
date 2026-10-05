import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACTIVE_EMBEDDING = Object.freeze({ provider: "gemini", model: "gemini-embedding-2", dimension: 768,
  version: "gemini-embedding-2:768:retrieval-v1:chunk-v1" });
export const SEARCH_LIMITS = Object.freeze({ chunk: 1200, overlap: 120, short: 200, chunks: 128,
  codePoints: 100_000, bytes: 400_000, cycle: 8, cacheSeconds: 300, requestsPerMinute: 30, embeddingsPerMinute: 10 });
export class SearchError extends Error {
  constructor(public readonly code: string, public readonly status = 400, public readonly retryAfter?: number) { super(code); }
}
export const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export type SearchInput = { query: string; filters: { source: string[]; format: string[]; from: string | null; to: string | null };
  limit: number; semantic: boolean; cursor: string | null };
const sources = ["gmail", "drive", "calendar", "upload", "manual"];
const formats = ["email", "pdf", "image", "screenshot", "document", "text", "calendar_event", "other"];
function list(v: unknown, allowed: string[]) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > allowed.length || v.some(x => typeof x !== "string" || !allowed.includes(x))) throw new SearchError("VALIDATION_ERROR");
  return [...new Set(v as string[])].sort();
}
function date(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new SearchError("VALIDATION_ERROR");
  return v;
}
export function parseSearch(v: unknown): SearchInput {
  const r = record(v), f = record(r.filters);
  if (Object.keys(r).some(k => !["query", "filters", "limit", "semantic", "cursor"].includes(k))
    || (r.filters !== undefined && (r.filters === null || Array.isArray(r.filters) || typeof r.filters !== "object"))
    || Object.keys(f).some(k => !["source", "format", "from", "to"].includes(k))
    || typeof r.query !== "string" || !r.query.trim() || Array.from(r.query.trim()).length > 500
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.query)
    || (r.semantic !== undefined && typeof r.semantic !== "boolean")
    || (r.cursor != null && (typeof r.cursor !== "string" || r.cursor.length > 2048))) throw new SearchError("VALIDATION_ERROR");
  const limit = r.limit ?? 20;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new SearchError("VALIDATION_ERROR");
  const from = date(f.from), to = date(f.to);
  if (from && to && from > to) throw new SearchError("VALIDATION_ERROR");
  return { query: r.query.trim().normalize("NFC"), filters: { source: list(f.source, sources), format: list(f.format, formats), from, to },
    limit: Number(limit), semantic: r.semantic === true, cursor: typeof r.cursor === "string" ? r.cursor : null };
}
export type Intent = { kind: "documents" | "actions"; from: string | null; to: string | null; term: string; deadlineOnly: boolean; warning: string | null };
const day = 86_400_000;
const ymd = (n: number) => new Date(n).toISOString().slice(0, 10);
/** Deliberately small Korean grammar; no LLM and no inferred Action/deadline. KST is the v1 contract. */
export function searchIntent(query: string, now = Date.now()): Intent {
  const q = query.replace(/\s+/g, " ").trim(), today = Date.parse(ymd(now + 9 * 3_600_000));
  let from: string | null = null, to: string | null = null;
  const relative = q.match(/지난달|이번 달|이번 주|다음 주|오늘|내일/);
  if (relative) {
    const d = new Date(today), word = relative[0];
    if (word.includes("달")) { const shift = word === "지난달" ? -1 : 0;
      from = ymd(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1)); to = ymd(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift + 1, 0));
    } else if (word.includes("주")) { const monday = today - ((d.getUTCDay() + 6) % 7) * day + (word === "다음 주" ? 7 * day : 0);
      from = ymd(monday); to = ymd(monday + 6 * day);
    } else from = to = ymd(today + (word === "내일" ? day : 0));
  }
  const action = /^(?:(?:오늘|내일|이번 주|다음 주|이번 달|지난달)(?:까지)?\s*)?(?:해야 할 일|할 일|마감(?:일)?|제출(?:해야 할 일)?|납부|신청)$/.test(q)
    || /^(?:오늘|내일)까지$/.test(q);
  if (action && /까지/.test(q) && to) from = null; // inclusive overdue + deadlines through requested day
  const bareMonth = /(?:^|\s)(?:[1-9]|1[0-2])월(?:까지)?/.test(q);
  return { kind: action ? "actions" : "documents", from, to,
    term: action ? (/제출|납부|신청/.exec(q)?.[0] ?? "") : query,
    deadlineOnly: action && (/마감|까지/.test(q) || relative !== null),
    warning: bareMonth ? "YEAR_REQUIRED" : !action && /마감|제출|까지/.test(q) ? "DEADLINE_FILTER_NOT_APPLIED" : null };
}
export function fingerprint(title: string, text: string, version = ACTIVE_EMBEDDING.version) { return hash(JSON.stringify([version, title, text])); }
export function cursorContext(input: SearchInput) { return hash(JSON.stringify([input.query, input.filters, input.limit, input.semantic, ACTIVE_EMBEDDING.version])); }
type Cursor = { session: string; offset: number; limit: number; context: string; version: string; expires: number };
function secret() { const key = process.env.SEARCH_CURSOR_SECRET?.trim(); if (!key || key.length < 32) throw new SearchError("SEARCH_NOT_CONFIGURED", 503); return key; }
export function encodeCursor(cursor: Cursor): string { const body = Buffer.from(JSON.stringify(cursor)).toString("base64url"); return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`; }
export function decodeCursor(token: string, context: string, userSessionVersion = ACTIVE_EMBEDDING.version): Cursor {
  const parts = token.split("."); if (parts.length !== 2) throw new SearchError("INVALID_CURSOR");
  const expected = createHmac("sha256", secret()).update(parts[0]).digest(), supplied = Buffer.from(parts[1], "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new SearchError("INVALID_CURSOR");
  let c: Record<string, unknown>; try { c = record(JSON.parse(Buffer.from(parts[0], "base64url").toString())); } catch { throw new SearchError("INVALID_CURSOR"); }
  if (!uuid(c.session) || !Number.isInteger(c.offset) || Number(c.offset) < 0 || Number(c.offset) > 200 || !Number.isInteger(c.limit)
    || Number(c.limit) < 1 || Number(c.limit) > 50 || c.context !== context || c.version !== userSessionVersion || !Number.isFinite(c.expires)) throw new SearchError("INVALID_CURSOR");
  if (Number(c.expires) <= Date.now()) throw new SearchError("CURSOR_EXPIRED", 410);
  return c as Cursor;
}
