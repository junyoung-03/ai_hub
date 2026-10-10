import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import { ACTIVE_EMBEDDING, SEARCH_LIMITS, SearchError, cursorContext, decodeCursor, encodeCursor, hash, parseSearch, record, searchIntent, uuid } from "./contract";
import { chunkItem, type SearchItem } from "./chunker";
import { createEmbeddingProvider, semanticItemAllowed, validateVector, type EmbeddingProvider } from "./provider";

type RpcName = "search_runtime" | "search_index" | "search_candidates" | "search_similar" | "search_coverage";
type Admin = ReturnType<typeof createAdminClient>;
// Local typed RPC adapter until the applied migration is reflected in generated DB types.
export function searchStore(admin: Admin = createAdminClient()) {
  const rpc = admin.rpc.bind(admin) as unknown as (name: RpcName, args: Record<string, Json | undefined>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  return { admin, async call(name: RpcName, args: Record<string, Json | undefined>): Promise<unknown> {
    const { data, error } = await rpc(name, args);
    if (error) throw new SearchError(error.code === "P0002" ? "NOT_FOUND" : error.code === "55P03" ? "INDEX_BUSY" : ["40001", "PT409"].includes(error.code ?? "") ? "STALE_INPUT" : "SEARCH_STORAGE_UNAVAILABLE",
      error.code === "P0002" ? 404 : error.code === "55P03" || ["40001", "PT409"].includes(error.code ?? "") ? 409 : 503);
    return data;
  } };
}
type Store = ReturnType<typeof searchStore>;
async function runtime(store: Store, userId: string, op: string, payload: unknown = {}) {
  return record(await store.call("search_runtime", { p_op: op, p_user_id: userId, p_payload: payload as Json }));
}
export async function consumeRate(store: Store, userId: string, category: "request" | "embedding" | "index") {
  const r = await runtime(store, userId, "rate", { category });
  if (r.allowed !== true) throw new SearchError("RATE_LIMITED", 429, Number(r.retryAfter) || 60);
}
function originalUrl(value: unknown, source: unknown): string | null {
  if (typeof value !== "string" || !["gmail", "drive", "calendar"].includes(String(source))) return null;
  try { const u = new URL(value), hosts: Record<string, string[]> = { gmail: ["mail.google.com"], drive: ["drive.google.com", "docs.google.com"], calendar: ["calendar.google.com", "www.google.com"] };
    return u.protocol === "https:" && !u.username && !u.password && !u.port && hosts[String(source)]?.includes(u.hostname) ? u.href : null;
  } catch { return null; }
}
function location(raw: unknown) {
  const r = record(raw), number = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 ? Number(v) : null;
  return { field: typeof r.field === "string" ? r.field : "content_text", offsetUnit: "unicode_code_point",
    startChar: number(r.startChar), endChar: number(r.endChar), page: Number.isInteger(r.page) && Number(r.page) >= 1 ? Number(r.page) : null,
    tabId: typeof r.tabId === "string" ? r.tabId : null, method: typeof r.method === "string" ? r.method : null };
}
/** Copy only safe fields. Every displayed excerpt is a source substring, never generated. */
export function serializeResult(raw: unknown, query: string): Record<string, Json> {
  const r = record(raw);
  if (r.kind === "action") {
    const sources = Array.isArray(r.sources) ? r.sources.map(value => { const s = record(value); return {
      itemId: String(s.itemId), title: String(s.title), source: String(s.source), format: String(s.format), text: String(s.text),
      location: location(s.location), originalUrl: originalUrl(s.originalUrl, s.source), snapshotUpdatedAt: String(s.snapshotUpdatedAt), detailUrl: `/items/${s.itemId}`,
    }; }) : [];
    if (!uuid(r.actionId) || !sources.length) throw new SearchError("INVALID_SEARCH_RESULT", 502);
    return { kind: "action", actionId: r.actionId, title: String(r.title), type: String(r.type), status: String(r.status),
      deadlineStatus: String(r.deadlineStatus), deadlineDate: typeof r.deadlineDate === "string" ? r.deadlineDate : null,
      deadlineAt: typeof r.deadlineAt === "string" ? r.deadlineAt : null,
      requirements: Array.isArray(r.requirements) ? r.requirements.filter(x => typeof x === "string") as string[] : [],
      conditions: Array.isArray(r.conditions) ? r.conditions.filter(x => typeof x === "string") as string[] : [],
      sources, matchType: "action_sql", score: 0, snapshotUpdatedAt: String(r.snapshotUpdatedAt) };
  }
  if (!uuid(r.itemId) || r.kind !== "item") throw new SearchError("INVALID_SEARCH_RESULT", 502);
  const matches: Json[] = [], spans: { start: number; end: number }[] = [];
  for (const value of Array.isArray(r.matchedChunks) ? r.matchedChunks : []) {
    const c = record(value), loc = location(c.location), text = typeof c.content === "string" ? c.content : "", points = Array.from(text);
    if (!text.trim()) continue;
    let position = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (position < 0) for (const term of query.split(/\s+/).filter(t => t.length >= 2)) { position = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()); if (position >= 0) break; }
    const start = Math.max(0, position < 0 ? 0 : Array.from(text.slice(0, position)).length - 80), end = Math.min(points.length, start + 300);
    const offset = loc.startChar ?? 0, span = { start: offset + start, end: offset + end };
    const rawLocation = record(c.location), ranges = Array.isArray(rawLocation.pages) ? rawLocation.pages : Array.isArray(rawLocation.tabs) ? rawLocation.tabs : [];
    for (const value of ranges) { const range = record(value); if (Number(range.start) <= span.start && Number(range.end) >= span.end) {
      if (Number.isInteger(range.page)) loc.page = Number(range.page);
      if (typeof range.id === "string") loc.tabId = range.id;
      if (typeof range.method === "string") loc.method = range.method;
    } }
    if (spans.some(s => s.start < span.end && span.start < s.end)) continue;
    spans.push(span);
    matches.push({ chunkId: typeof c.chunkId === "string" ? c.chunkId : null, chunkIndex: Number.isInteger(c.chunkIndex) ? Number(c.chunkIndex) : null,
      excerpt: points.slice(start, end).join(""), location: { ...loc, startChar: span.start, endChar: span.end } });
  }
  if (!matches.length) matches.push({ chunkId: null, chunkIndex: null, excerpt: String(r.title), location: { field: "title", startChar: 0, endChar: Array.from(String(r.title)).length, offsetUnit: "unicode_code_point", page: null, tabId: null, method: null } });
  const cal = record(r.calendar), calDate = (v: unknown): Json => {
    const d = record(v); return { date: typeof d.date === "string" ? d.date : null, dateTime: typeof d.dateTime === "string" ? d.dateTime : null, timeZone: typeof d.timeZone === "string" ? d.timeZone : null };
  };
  return { kind: "item", itemId: r.itemId, title: String(r.title), source: String(r.source), format: String(r.format),
    score: Number(r.score), matchType: String(r.matchType), excerpt: record(matches[0]).excerpt as string, matchedChunks: matches,
    detailUrl: `/items/${r.itemId}`, originalUrl: originalUrl(r.originalUrl, r.source),
    originalEndpoint: r.source === "upload" ? `/api/v1/items/${r.itemId}/original` : null,
    sourceDate: typeof r.sourceDate === "string" ? r.sourceDate : null, sourceDateKind: String(r.sourceDateKind),
    calendar: r.source === "calendar" ? { start: calDate(cal.start), end: calDate(cal.end), allDay: cal.allDay === true, status: typeof cal.status === "string" ? cal.status : null } : null,
    snapshotUpdatedAt: String(r.snapshotUpdatedAt) };
}

export async function search(value: unknown, provider: EmbeddingProvider = createEmbeddingProvider(), injected?: Store) {
  if (provider.identity.version !== ACTIVE_EMBEDDING.version || provider.identity.dimension !== ACTIVE_EMBEDDING.dimension
    || provider.identity.provider !== ACTIVE_EMBEDDING.provider || provider.identity.model !== ACTIVE_EMBEDDING.model) throw new SearchError("EMBEDDING_VERSION_MISMATCH", 503);
  const user = await requireUser(), input = parseSearch(value), store = injected ?? searchStore(), context = cursorContext(input);
  await consumeRate(store, user.id, "request");
  let session: string, expires: number, offset = 0;
  if (input.cursor) { const c = decodeCursor(input.cursor, context); session = c.session; expires = c.expires; offset = c.offset; }
  else {
    // Validate pagination configuration before any external provider request.
    encodeCursor({ session: "10000000-0000-4000-8000-000000000000", offset: 0, limit: input.limit, context, version: ACTIVE_EMBEDDING.version, expires: Date.now() + 300_000 });
    const intent = searchIntent(input.query), filters = { ...input.filters };
    if (intent.kind === "documents") { filters.from ??= intent.from; filters.to ??= intent.to; }
    else { intent.from = filters.from ?? intent.from; intent.to = filters.to ?? intent.to; }
    let vector: number[] | null = null, degraded = false, retryAfter: number | null = null, querySentToProvider = false;
    const semanticEnabled = input.semantic && intent.kind === "documents" && process.env.SEARCH_SEMANTIC_ENABLED === "true";
    if (semanticEnabled) {
      const key = hash(JSON.stringify([ACTIVE_EMBEDDING.version, input.query, filters, "Asia/Seoul"])), cache = await runtime(store, user.id, "query_claim", { key, version: ACTIVE_EMBEDDING.version });
      if (cache.state === "cached") vector = validateVector(JSON.parse(String(cache.embedding)));
      else if (cache.state === "claimed") {
        try {
          await consumeRate(store, user.id, "embedding");
          querySentToProvider = true;
          vector = await provider.embedQuery(input.query);
          await runtime(store, user.id, "query_finish", { key, version: ACTIVE_EMBEDDING.version, attempt: cache.attempt, embedding: JSON.stringify(vector) });
        } catch (error) {
          await runtime(store, user.id, "query_release", { key, version: ACTIVE_EMBEDDING.version, attempt: cache.attempt }).catch(() => {});
          if (error instanceof SearchError && error.code === "RATE_LIMITED") throw error;
          vector = null; degraded = true; retryAfter = error instanceof SearchError ? error.retryAfter ?? null : null;
        }
      } else degraded = true;
    } else if (input.semantic && intent.kind === "documents") degraded = true;
    const raw = await store.call("search_candidates", { p_user_id: user.id, p_version: ACTIVE_EMBEDDING.version, p_query: input.query,
      p_vector: vector ? JSON.stringify(vector) : null, p_filters: filters, p_intent: intent as unknown as Json });
    if (!Array.isArray(raw)) throw new SearchError("INVALID_SEARCH_RESULT", 502);
    const coverage = await store.call("search_coverage", { p_user_id: user.id, p_version: ACTIVE_EMBEDDING.version });
    const info = { coverage, intent: intent.kind, appliedFilters: intent.kind === "actions" ? { ...filters, from: intent.from, to: intent.to, dateBasis: "action_deadline" } : { ...filters, dateBasis: "source_date" },
      mode: intent.kind === "actions" ? "action_sql" : vector ? "hybrid" : "keyword_only", degraded, retryAfter,
      semantic: { requested: input.semantic, querySentToProvider, provider: semanticEnabled ? ACTIVE_EMBEDDING.provider : null,
        disclosure: "semantic=true 검색 query는 Gemini에 외부 전송될 수 있습니다. Unpaid Services에서는 입력·출력이 제품/ML 개선 및 사람의 검토에 사용될 수 있으므로 민감·기밀·개인정보를 보내지 마세요. 환경별 Paid/Unpaid 데이터 사용 조건을 확인하세요." },
      embeddingVersion: ACTIVE_EMBEDDING.version, warning: intent.warning, timezone: "Asia/Seoul", debounceMs: 350,
      maxResults: 200, truncated: raw.length >= 200 };
    const saved = await runtime(store, user.id, "snapshot", { context, version: ACTIVE_EMBEDDING.version, results: raw.map(r => serializeResult(r, input.query)), info });
    session = String(saved.id); expires = Number(saved.expires);
  }
  const page = await runtime(store, user.id, "page", { session, context, version: ACTIVE_EMBEDDING.version, offset, limit: input.limit });
  const results = Array.isArray(page.results) ? page.results : [];
  // Internal source revision markers never leave the server.
  for (const result of results) { const r = record(result); if (Array.isArray(r.sources)) r.sources = r.sources.map(s => { const source = { ...record(s) }; delete source.snapshotUpdatedAt; return source; }); }
  return { ...record(page.info), status: results.length ? "results" : "no_results", results, limit: input.limit,
    nextCursor: page.hasMore === true ? encodeCursor({ session, offset: Number(page.nextOffset), limit: input.limit, context, version: ACTIVE_EMBEDDING.version, expires }) : null };
}

export async function indexItem(itemId: string, provider: EmbeddingProvider = createEmbeddingProvider(), injected?: Store, retry = false) {
  if (provider.identity.version !== ACTIVE_EMBEDDING.version || provider.identity.dimension !== ACTIVE_EMBEDDING.dimension
    || provider.identity.provider !== ACTIVE_EMBEDDING.provider || provider.identity.model !== ACTIVE_EMBEDDING.model) throw new SearchError("EMBEDDING_VERSION_MISMATCH", 503);
  const user = await requireUser(); if (!uuid(itemId)) throw new SearchError("NOT_FOUND", 404);
  const store = injected ?? searchStore(); await consumeRate(store, user.id, "index");
  const { data: item, error } = await store.admin.from("items").select("id,user_id,title,content_text,source,metadata,updated_at").eq("user_id", user.id).eq("id", itemId).maybeSingle();
  if (error) throw new SearchError("SEARCH_STORAGE_UNAVAILABLE", 503); if (!item) throw new SearchError("NOT_FOUND", 404);
  const call = async (op: string, payload: unknown = {}, attempt?: string) => record(await store.call("search_index", {
    p_op: op, p_user_id: user.id, p_item_id: itemId, p_version: ACTIVE_EMBEDDING.version, p_payload: payload as Json, p_attempt: attempt }));
  let prepared: ReturnType<typeof chunkItem>;
  try { prepared = chunkItem(item as SearchItem); } catch (e) { if (e instanceof SearchError && ["TEXT_LIMIT", "CHUNK_LIMIT"].includes(e.code)) { await call("skip"); return { state: "skipped_limit" }; } throw e; }
  if (retry) await call("reset_retry");
  const semantic = semanticItemAllowed(itemId), claim = await call("claim", { fingerprint: prepared.fingerprint, snapshot: item.updated_at, chunkCount: prepared.chunks.length, semantic });
  if (claim.state !== "claimed") return claim;
  const attempt = String(claim.attempt), start = Number(claim.nextChunk), end = Math.min(start + SEARCH_LIMITS.cycle, prepared.chunks.length), endsAt = Date.now() + 35_000;
  try {
    const { data: previous, error: readError } = await store.admin.from("search_chunks").select("input_hash,embedding,embedding_version").eq("user_id", user.id).eq("item_id", itemId).eq("embedding_version", ACTIVE_EMBEDDING.version).limit(128);
    if (readError) throw new SearchError("SEARCH_STORAGE_UNAVAILABLE", 503);
    let processed = start;
    for (let i = start; i < end && Date.now() + 16_000 < endsAt; i++) {
      const chunk = prepared.chunks[i], reusable = previous?.find(c => c.input_hash === chunk.inputHash && c.embedding);
      let embedding: number[] | null = null;
      if (semantic) {
        if (reusable?.embedding) embedding = validateVector(JSON.parse(reusable.embedding));
        else { await consumeRate(store, user.id, "embedding"); embedding = await provider.embedDocument(item.title, chunk.content); }
      }
      await call("write", { chunk, model: ACTIVE_EMBEDDING.model, embedding: embedding ? JSON.stringify(embedding) : null }, attempt); processed++;
    }
    const complete = processed === prepared.chunks.length; await call(complete ? "finish" : "release", {}, attempt);
    return { state: complete ? "complete" : "pending", nextChunk: processed, chunkCount: prepared.chunks.length, semantic, embeddingVersion: ACTIVE_EMBEDDING.version };
  } catch (error) {
    await call("fail", { code: error instanceof SearchError ? error.code : "INDEX_FAILED", retryAfter: error instanceof SearchError ? error.retryAfter ?? 60 : 60 }, attempt).catch(() => {});
    throw error;
  }
}

export async function similarItems(itemId: string, limit = 5, injected?: Store) {
  const user = await requireUser(); if (!uuid(itemId) || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new SearchError("VALIDATION_ERROR");
  const store = injected ?? searchStore(); await consumeRate(store, user.id, "request");
  const { data, error } = await store.admin.from("items").select("id").eq("id", itemId).eq("user_id", user.id).maybeSingle();
  if (error) throw new SearchError("SEARCH_STORAGE_UNAVAILABLE", 503); if (!data) throw new SearchError("NOT_FOUND", 404);
  const rows = await store.call("search_similar", { p_user_id: user.id, p_item_id: itemId, p_version: ACTIVE_EMBEDDING.version, p_limit: limit });
  const indexed = record(await store.call("search_index", { p_op: "read", p_user_id: user.id, p_item_id: itemId, p_version: ACTIVE_EMBEDDING.version }));
  return { status: indexed.state === "complete" && indexed.semantic === true ? "results" : "not_indexed", embeddingVersion: ACTIVE_EMBEDDING.version,
    results: Array.isArray(rows) ? rows.map(v => { const r = record(v); return { itemId: r.itemId, title: r.title, source: r.source, format: r.format,
      score: r.score, detailUrl: `/items/${r.itemId}`, originalUrl: originalUrl(r.originalUrl, r.source) }; }) : [] };
}
