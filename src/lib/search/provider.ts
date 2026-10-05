import "server-only";
import { ACTIVE_EMBEDDING, SearchError } from "./contract";
export interface EmbeddingProvider {
  readonly identity: typeof ACTIVE_EMBEDDING;
  embedDocument(title: string, chunk: string): Promise<number[]>;
  embedQuery(query: string): Promise<number[]>;
}
export function validateVector(v: unknown): number[] {
  if (!Array.isArray(v) || v.length !== ACTIVE_EMBEDDING.dimension || v.some(n => typeof n !== "number" || !Number.isFinite(n))
    || v.every(n => n === 0)) throw new SearchError("INVALID_EMBEDDING", 502);
  return v;
}
export function createEmbeddingProvider(transport: typeof fetch = fetch): EmbeddingProvider {
  async function embed(text: string) {
    if (process.env.SEARCH_SEMANTIC_ENABLED !== "true") throw new SearchError("SEMANTIC_DISABLED", 403);
    const key = process.env.GEMINI_API_KEY?.trim(); if (!key) throw new SearchError("EMBEDDING_NOT_CONFIGURED", 503);
    const response = await transport(`https://generativelanguage.googleapis.com/v1beta/models/${ACTIVE_EMBEDDING.model}:embedContent`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ content: { parts: [{ text }] }, embedContentConfig: { outputDimensionality: ACTIVE_EMBEDDING.dimension, autoTruncate: false } }),
    }).catch(() => { throw new SearchError("EMBEDDING_UNAVAILABLE", 503); });
    if (!response.ok) {
      const advised = response.headers.get("Retry-After"), n = advised ? Number(advised) : NaN;
      const retry = Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : advised && Number.isFinite(Date.parse(advised)) ? Math.max(1, Math.ceil((Date.parse(advised) - Date.now()) / 1000)) : 60;
      throw new SearchError("EMBEDDING_UNAVAILABLE", response.status === 429 ? 429 : 503, retry);
    }
    const result = await response.json().catch(() => { throw new SearchError("INVALID_EMBEDDING", 502); });
    return validateVector(result.embedding?.values);
  }
  return { identity: ACTIVE_EMBEDDING,
    embedDocument: (title, chunk) => embed(`title: ${title || "none"} | text: ${chunk}`),
    embedQuery: query => embed(`task: search result | query: ${query}`) };
}
export function semanticItemAllowed(itemId: string) {
  // Server deployment allowlist only; clients cannot classify their own text as non-sensitive.
  return process.env.SEARCH_SEMANTIC_ENABLED === "true" && (process.env.SEARCH_NON_SENSITIVE_ITEM_IDS ?? "").split(",").map(v => v.trim()).includes(itemId);
}
