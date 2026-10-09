import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, { exports, Buffer, TextEncoder, TextDecoder, URL, URLSearchParams, Request, Response,
    AbortSignal, AbortController, Date, setTimeout, clearTimeout, process: { env: {} }, ...globals,
    require(name) { if (name === "server-only") return {}; if (name in imports) return imports[name];
      if (name === "@/lib/items/analysis-policy") return load("src/lib/items/analysis-policy.ts");
      if (name.startsWith("node:")) return require(name); throw new Error(`Missing test dependency: ${name}`); },
  });
  return exports;
}
const contract = load("src/lib/google/drive-contract.ts");
const extractor = load("src/lib/google/docs-text.ts", { "@/lib/google/drive-contract": contract });
const tab = (text, id = "tab1", children = []) => ({ tabProperties: { tabId: id, title: `Title-${id}` },
  documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] } }, childTabs: children });
test("Drive input accepts one explicit target mode and rejects arbitrary queries, recursive flags, duplicates and >20 IDs", () => {
  assert.ok(contract.parseDriveInput({ mode: "folder", folderId: "folder1" }));
  assert.ok(contract.parseDriveInput({ mode: "files", fileIds: ["file1"] }));
  for (const v of [{ mode: "folder", folderId: "x", fileIds: ["y"] }, { mode: "files", fileIds: ["x", "x"] },
    { mode: "folder", folderId: "x' or true" }, { mode: "folder", folderId: "x", recursive: true },
    { mode: "files", fileIds: [] }, { mode: "files", fileIds: Array.from({ length: 21 }, (_, i) => `file${i}`) }])
    assert.equal(contract.parseDriveInput(v), null);
});
test("all tabs preserve parent-child, table and TOC order and record Unicode offsets without tab titles or Google indexes", () => {
  const parent = tab("A😀", "p", [tab("Child\n", "c")]);
  parent.documentTab.body.content.push({ table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "Cell\n" }, startIndex: 900 }] } }] }] }] } });
  parent.documentTab.body.content.push({ tableOfContents: { content: [{ paragraph: { elements: [{ textRun: { content: "TOC\n" } }] } }] } });
  const r = extractor.extractDocsText({ tabs: [parent, tab("Last", "last")] });
  assert.equal(r.text, "A😀Cell\nTOC\nChild\nLast");
  assert.equal(r.metadata.tabs[0].end, 11);
  assert.equal(r.metadata.tabs[1].start, 11);
  assert.equal(r.metadata.tabs[1].parentId, "p");
  assert.equal(r.codePoints, Array.from(r.text).length);
  assert.equal(r.bytes, Buffer.byteLength(r.text));
  assert.equal(r.metadata.extractionVersion, "docs-text-v1");
});
test("unsupported contents are excluded and reported, including unaccepted inserted suggestions", () => {
  const t = tab("Body");
  Object.assign(t.documentTab, { headers: { h: {} }, footers: { f: {} }, footnotes: { n: {} }, inlineObjects: { image: {} } });
  t.documentTab.body.content[0].paragraph.elements.push({ textRun: { content: "Unaccepted" }, suggestedInsertionIds: ["s"] },
    { inlineObjectElement: {} }, { footnoteReference: {} });
  const r = extractor.extractDocsText({ tabs: [t] });
  assert.equal(r.text, "Body");
  for (const key of ["header", "footer", "footnote", "image", "suggestion"]) assert.equal(r.metadata.exclusions[key], true);
  assert.equal(r.metadata.exclusions.comment, "not_collected");
});
test("text limits count code points and UTF8 bytes; rejected documents never return a truncated body", () => {
  assert.equal(extractor.extractDocsText({ tabs: [tab("😀".repeat(100000))] }).bytes, 400000);
  assert.throws(() => extractor.extractDocsText({ tabs: [tab("a".repeat(100001))] }), /DOCUMENT_LIMIT/);
  assert.throws(() => extractor.extractDocsText({ tabs: [] }), /GOOGLE_UNAVAILABLE/);
});
const scopes = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/documents.readonly"];
async function clientWith(send, granted = scopes) {
  const api = load("src/lib/google/drive-client.ts", {
    "@/lib/google/drive-contract": contract,
    "@/lib/google/data-oauth": { DRIVE_DOCS_SCOPES: scopes.slice(1), refreshGoogleAccessToken: async () => { throw new Error("Unexpected refresh"); } },
    "@/lib/google/connections": { getGoogleConnectionTokens: async () => ({ accessToken: "synthetic", scopes: granted,
      refreshToken: "synthetic", accessTokenCiphertext: "synthetic", expiresAt: new Date(Date.now() + 3600000).toISOString() }),
      getGoogleOAuthConnection: async () => ({ id: "connection", status: "connected", scopes: granted }), refreshGoogleConnectionTokens: async () => false },
  }, { fetch: send });
  return api.createDriveClient("owner", "connection");
}
const file = (id = "file1", version = "2026-10-01T00:00:00Z") => ({ id, name: "Synthetic", mimeType: contract.DOCS_MIME,
  trashed: false, parents: ["folder1"], createdTime: "2026-09-01T00:00:00Z", modifiedTime: version });
test("Google requests use server-controlled parent query, fields and all-tab preview parameters", async () => {
  const urls = [];
  const client = await clientWith(async (url, options) => {
    urls.push(url); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    if (url.hostname === "docs.googleapis.com") return Response.json({ documentId: "file1", tabs: [tab("text")] });
    return Response.json(url.pathname.endsWith("file1") ? file() : { files: [file()] });
  });
  await client.file("file1", AbortSignal.timeout(1000));
  await client.children("folder1", null, AbortSignal.timeout(1000));
  await client.document("file1", AbortSignal.timeout(1000));
  assert.equal(urls[1].searchParams.get("pageSize"), "20");
  assert.match(urls[1].searchParams.get("q"), /^'folder1' in parents/);
  assert.equal(urls[1].searchParams.get("includeItemsFromAllDrives"), "false");
  assert.equal(urls[2].searchParams.get("includeTabsContent"), "true");
  assert.equal(urls[2].searchParams.get("suggestionsViewMode"), "PREVIEW_WITHOUT_SUGGESTIONS");
});
test("429/5xx retry only once, access errors never retry and missing Drive consent makes zero requests", async () => {
  for (const status of [429, 503, 401, 403, 404]) {
    let calls = 0; const client = await clientWith(async () => { calls++; return new Response("suppressed-provider-error", { status }); });
    await assert.rejects(client.file("file1", AbortSignal.timeout(1000)));
    assert.equal(calls, status === 429 || status === 503 ? 2 : 1);
  }
  await assert.rejects(clientWith(async () => { throw new Error("Unexpected request"); }, scopes.slice(0, 1)), /DRIVE_CONSENT_REQUIRED/);
});
function collector({ existing = null, before = file(), after = before, text = "Body", ids = ["file1"], limits, list, analysed = false, candidateError = false } = {}) {
  const calls = { docs: 0, metadata: 0, writes: [], inFlight: 0, peak: 0 };
  const fixtureContract = limits ? { ...contract, DRIVE_LIMITS: { ...contract.DRIVE_LIMITS, ...limits } } : contract;
  const reader = (connection = false) => {
    let candidates = false;
    const chain = { select() { return chain; }, eq() { return chain; }, is() { return chain; }, abortSignal() { return chain; }, in() { candidates = true; return chain; },
      async limit() {
        if (!candidates) return { data: [{ id: "connection", status: "connected" }], error: null };
        const p = load("src/lib/items/analysis-policy.ts");
        return { data: [{ id: existing?.id ?? "new-item", source: "drive", format: "document", content_text: text,
          metadata: analysed ? { aiAnalysis: { schemaVersion: "0.2", model: "gemini-fixture", inputFingerprint: p.analysisFingerprint(text, "gemini-fixture") } } : {} }], error: candidateError ? { code: "synthetic" } : null };
      },
      async maybeSingle() { return { data: connection ? null : existing, error: null }; } };
    return chain;
  };
  const api = load("src/lib/google/drive-collection.ts", {
    "@/lib/supabase/auth": { async requireUser() { return { id: "owner" }; } },
    "@/lib/supabase/server": { async createClient() { return { from(name) { return reader(name === "connections"); } }; } },
    "@/lib/supabase/admin": { createAdminClient() { return { rpc(name, args) {
      assert.equal(name, "persist_drive_item"); calls.writes.push(args);
      return { async abortSignal() { return { data: { item_id: existing?.id ?? "new-item", outcome: existing ? "updated" : "created" }, error: null }; } };
    } }; } },
    "@/lib/google/drive-contract": fixtureContract, "@/lib/google/docs-text": extractor,
    "@/lib/google/drive-client": { async createDriveClient() { return {
      async file(id) { calls.metadata++; if (id === "folder1") return { ...file(id), mimeType: contract.FOLDER_MIME };
        return calls.docs ? { ...after, id } : { ...before, id }; },
      async document(id) { calls.docs++; calls.inFlight++; calls.peak = Math.max(calls.peak, calls.inFlight);
        await new Promise(r => setTimeout(r, 5)); calls.inFlight--; return { tabs: [tab(text, id)] }; },
      async children(...args) { return list ? list(...args) : { files: ids.map(id => file(id)), nextPageToken: null }; },
    }; } },
  }, { process: { env: { GEMINI_MODEL: "gemini-fixture" } } });
  return { calls, collect: input => api.collectDrive(input ?? { mode: "files", fileIds: ids }) };
}
test("Drive successful persistence discovers unanalysed candidates, analysed skips and discovery errors preserve collection", async () => {
  assert.equal((await collector().collect()).analysisItemIds.length, 1);
  assert.equal((await collector({ analysed: true }).collect()).analysisItemIds.length, 0);
  const r = await collector({ candidateError: true }).collect(); assert.equal(r.complete, true); assert.equal(r.analysisDiscoveryFailed, true); assert.equal(r.created, 1);
});
test("create, same modifiedTime reuse without body GET and changed source update all preserve ITEM identity contract", async () => {
  const created = collector(); assert.equal((await created.collect()).created, 1);
  assert.equal(created.calls.writes[0].p_expected_item_updated_at, null);
  assert.equal(created.calls.writes[0].p_file_id, "file1");
  const reused = collector({ existing: { id: "same-item", source_updated_at: file().modifiedTime, updated_at: "stamp" } });
  assert.equal((await reused.collect()).results[0].itemId, "same-item"); assert.equal(reused.calls.docs, 0); assert.equal(reused.calls.writes.length, 0);
  const updated = collector({ existing: { id: "same-item", source_updated_at: "2026-09-01", updated_at: "stamp" } });
  assert.equal((await updated.collect()).updated, 1);
  assert.equal(updated.calls.writes[0].p_expected_item_updated_at, "stamp");
  assert.equal(Object.keys(updated.calls.writes[0]).some(key => /classification|action|evidence|override/.test(key)), false);
});
test("source changed or oversized documents never write; other files still produce partial success", async () => {
  const changed = collector({ after: file("file1", "2026-10-02T00:00:00Z") });
  assert.equal((await changed.collect()).results[0].code, "SOURCE_CHANGED"); assert.equal(changed.calls.writes.length, 0);
  const large = collector({ text: "a".repeat(100001) });
  assert.equal((await large.collect()).results[0].code, "DOCUMENT_LIMIT"); assert.equal(large.calls.writes.length, 0);
  for (const overrides of [{ driveId: "shared" }, { trashed: true }, { mimeType: "application/pdf" }]) {
    const c = collector({ before: { ...file(), ...overrides } });
    assert.equal((await c.collect()).excluded, 1); assert.equal(c.calls.docs, 0);
  }
});
test("folder pagination has 5-page ceiling, 20-file cap and no recursive calls", async () => {
  let pages = 0;
  const empty = collector({ list: async () => ({ files: [], nextPageToken: `page${++pages}` }) });
  const stopped = await empty.collect({ mode: "folder", folderId: "folder1" });
  assert.equal(stopped.pagesRead, 5); assert.equal(stopped.stopReason, "PAGE_LIMIT");
  const full = collector({ ids: Array.from({ length: 20 }, (_, i) => `f${i}`), list: async () => ({ files: Array.from({ length: 20 }, (_, i) => file(`f${i}`)), nextPageToken: "more" }) });
  const r = await full.collect({ mode: "folder", folderId: "folder1" });
  assert.equal(r.results.length, 20); assert.equal(r.stopReason, "FILE_LIMIT"); assert.equal(r.pagesRead, 1);
  assert.ok(full.calls.peak <= 2);
});
test("2MB aggregate text budget reserves concurrent downloads; stopping never writes a truncated body", async () => {
  const c = collector({ text: "😀".repeat(100000), ids: Array.from({ length: 8 }, (_, i) => `f${i}`) });
  const r = await c.collect();
  assert.ok(r.downloadedTextBytes <= 2000000); assert.equal(r.stopReason, "RUN_BYTES_LIMIT");
  assert.ok(r.unprocessed > 0); assert.ok(c.calls.peak <= 2);
  for (const row of c.calls.writes) assert.equal(Buffer.byteLength(row.p_content_text), 400000);
  const oversize = collector({ text: "a".repeat(100001), ids: Array.from({ length: 10 }, (_, i) => `f${i}`) });
  const rejected = await oversize.collect();
  assert.equal(rejected.stopReason, "RUN_BYTES_LIMIT"); assert.ok(oversize.calls.docs <= 5);
  assert.equal(oversize.calls.writes.length, 0);
});
test("file/run timeout blocks pending writes and marks unfinished files explicitly", async () => {
  const perFile = collector({ limits: { fileMs: 1 } });
  assert.equal((await perFile.collect()).results[0].code, "FILE_TIMEOUT"); assert.equal(perFile.calls.writes.length, 0);
  const run = collector({ limits: { runMs: 1 }, ids: ["file1", "file2", "file3"] });
  const r = await run.collect(); assert.equal(r.stopReason, "RUN_TIMEOUT");
  assert.equal(r.complete, false); assert.equal(r.unprocessed, 1); assert.equal(run.calls.writes.length, 0);
});
test("collect API rejects ambiguous/unbounded bodies and cross-origin writes, and sanitizes provider errors", async () => {
  let called = 0;
  const route = load("src/app/api/v1/connections/google/drive/collect/route.ts", {
    "@/lib/google/drive-contract": contract,
    "@/lib/google/drive-collection": { async collectDrive() { called++; throw new contract.DriveError("GOOGLE_UNAVAILABLE"); } },
    "@/lib/google/http": { connectionResponse: (value, status = 200) => Response.json(value, { status }),
      connectionErrorResponse: () => Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }) },
  });
  const request = (body, origin = "http://localhost") => new Request("http://localhost/api/v1/connections/google/drive/collect", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { origin },
  });
  assert.equal((await route.POST(request({ mode: "files", fileIds: ["file1"] }, "http://foreign"))).status, 403);
  assert.equal((await route.POST(request({ mode: "files", fileIds: ["file1"], q: "unsafe" }))).status, 400);
  assert.equal((await route.POST(request("x".repeat(8193)))).status, 400);
  assert.equal(called, 0);
  const response = await route.POST(request({ mode: "files", fileIds: ["file1"] }));
  assert.equal(response.status, 502); assert.equal(called, 1);
  assert.doesNotMatch(await response.text(), /synthetic|token|raw|body/i);
});
test("persist RPC draft forces source, locks connection before ITEM, validates hash and protects analysis tables", () => {
  const sql = readFileSync("tests/fixtures/sql/drive/persist_drive_item.sql", "utf8");
  assert.match(sql, /security definer set search_path=''/);
  assert.match(sql, /from public,anon,authenticated,service_role/);
  assert.match(sql, /to service_role/);
  assert.ok(sql.indexOf("from public.connections") < sql.indexOf("from public.items"));
  assert.match(sql, /source_updated_at>p_source_updated_at/);
  assert.match(sql, /v_item.updated_at is distinct from p_expected_item_updated_at/);
  assert.match(sql, /sha256\(convert_to/);
  assert.match(sql, /'drive','document',p_file_id,null/);
  assert.doesNotMatch(sql, /(?:update|delete from|insert into) public\.(?:classifications|actions|action_sources)/i);
  assert.doesNotMatch(sql, /create (?:table|index)|alter table|create policy|http_get/i);
});
