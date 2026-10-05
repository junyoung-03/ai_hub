import { ACTIVE_EMBEDDING, SEARCH_LIMITS, SearchError, fingerprint, hash, record } from "./contract";
export type SearchItem = { id: string; user_id: string; title: string; content_text: string | null; source: string; metadata: unknown; updated_at: string };
export type Chunk = { chunkIndex: number; content: string; contentHash: string; inputHash: string; metadata: {
  field: string; startChar: number; endChar: number; offsetUnit: "unicode_code_point"; page: number | null; tabId: string | null; method: string | null } };
export function chunkItem(item: SearchItem): { chunks: Chunk[]; fingerprint: string } {
  const text = item.content_text ?? "", points = Array.from(text), metadata = record(item.metadata);
  if (points.length > SEARCH_LIMITS.codePoints || Buffer.byteLength(text) > SEARCH_LIMITS.bytes) throw new SearchError("TEXT_LIMIT", 422);
  const upload = record(record(metadata.upload).extraction), docs = record(record(metadata.drive).extraction);
  // Drive's persisted extraction uses docsText (and older snapshots may expose extraction).
  const drive = record(metadata.drive), extraction = Array.isArray(drive.tabs) ? drive : record(drive.docsText ?? drive.extraction ?? metadata.docsText ?? docs);
  const ranges: { start: number; end: number; page: number | null; tabId: string | null; method: string | null }[] = [];
  const supplied = item.source === "upload" ? upload.pages : item.source === "drive" ? extraction.tabs : null;
  if (Array.isArray(supplied)) for (const raw of supplied) {
    const r = record(raw);
    if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || Number(r.start) < 0 || Number(r.end) < Number(r.start) || Number(r.end) > points.length) throw new SearchError("INVALID_SOURCE_RANGE", 422);
    ranges.push({ start: Number(r.start), end: Number(r.end), page: Number.isInteger(r.page) ? Number(r.page) : null,
      tabId: typeof r.id === "string" ? r.id : null, method: typeof r.method === "string" ? r.method : null });
  }
  ranges.sort((a, b) => a.start - b.start);
  if (!ranges.length) ranges.push({ start: 0, end: points.length, page: null, tabId: null, method: null });
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end) throw new SearchError("INVALID_SOURCE_RANGE", 422);
  const chunks: Chunk[] = [];
  function push(start: number, end: number, range: typeof ranges[number]) {
    const content = points.slice(start, end).join(""); if (!content.trim()) return;
    chunks.push({ chunkIndex: chunks.length, content, contentHash: hash(content), inputHash: fingerprint(item.title, content),
      metadata: { field: "content_text", startChar: start, endChar: end, offsetUnit: "unicode_code_point", page: range.page, tabId: range.tabId, method: range.method } });
  }
  for (const r of ranges) {
    let start = r.start;
    while (start < r.end) {
      let end = Math.min(start + SEARCH_LIMITS.chunk, r.end);
      if (end < r.end) {
        const section = points.slice(start, end).join("");
        const boundary = [...section.matchAll(/\n\s*\n|[.!?。！？]\s/g)].at(-1);
        const candidate = boundary ? start + Array.from(section.slice(0, boundary.index! + boundary[0].length)).length : 0;
        if (candidate - start >= SEARCH_LIMITS.chunk / 2) end = candidate;
        // Merge a short tail only when the maximum size still holds.
        if (r.end - end < SEARCH_LIMITS.short && r.end - start <= SEARCH_LIMITS.chunk) end = r.end;
      }
      push(start, end, r); if (end === r.end) break;
      start = Math.max(start + 1, end - SEARCH_LIMITS.overlap);
    }
  }
  if (chunks.length > SEARCH_LIMITS.chunks) throw new SearchError("CHUNK_LIMIT", 422);
  return { chunks, fingerprint: hash(JSON.stringify([fingerprint(item.title, text, ACTIVE_EMBEDDING.version), ranges])) };
}
