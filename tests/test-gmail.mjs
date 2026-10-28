// Synthetic mail and in-memory persistence only. No real credentials or Gmail requests.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as parse5 from "parse5";

const require = createRequire(import.meta.url);
function load(path, imports = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(source, { exports, Buffer, TextDecoder, URL, URLSearchParams, Response, AbortSignal, Date, process: { env: {} }, ...globals,
    require(name) {
      if (name === "server-only") return {};
      if (name in imports) return imports[name];
      if (name === "@/lib/items/analysis-policy") return load("src/lib/items/analysis-policy.ts");
      if (name === "parse5") return parse5;
      if (name === "node:crypto") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const parser = load("src/lib/google/gmail-message.ts");
const part = (mime, text, rest = {}) => ({ mimeType: mime, body: { data: Buffer.from(text).toString("base64url"), size: text.length }, ...rest });
const message = (id = "fixture1", payload = part("text/plain", "본문")) => ({ id, threadId: "threadfixture", internalDate: "1791057600000", historyId: "100", labelIds: ["INBOX"], payload });

test("nested mixed/alternative prefers plain; binary and text attachments never decoded", () => {
  const attachment = { mimeType: "image/png", filename: "image.png", body: { attachmentId: "synthetic", size: 123, data: "invalid$binary" } };
  const value = parser.mapGmailMessage(message("fixture1", { mimeType: "multipart/mixed", parts: [
    { mimeType: "multipart/alternative", parts: [part("text/html", "<p>HTML duplicate</p>"), part("text/plain", "본문\r\n내용")] },
    attachment, part("text/plain", "DO NOT INCLUDE", { filename: "private.txt" }),
  ] }), "fixture1");
  assert.equal(value.contentText, "본문\n내용");
  assert.equal(value.metadata.attachments.length, 2);
  assert.equal(value.metadata.attachments[0].hasAttachmentId, true);
  assert.ok(!JSON.stringify(value).includes("synthetic"));
});

test("HTML fallback decodes entities/malformed markup; scripts/styles/inline image data excluded", () => {
  const value = parser.mapGmailMessage(message("fixture1", part("text/html", '<div>Hello&nbsp;world &amp; <b>한국</b><br>line<script>private()</script><style>.bad{}</style><img src="data:private"><p>끝')), "fixture1");
  assert.equal(value.contentText, "Hello world & 한국\nline\n끝");
  assert.ok(!value.contentText.includes("<"));
});

test("plain text priority survives a nested multipart branch", () => {
  const value = parser.mapGmailMessage(message("fixture1", { mimeType: "multipart/alternative", parts: [
    part("text/html", "<p>Do not duplicate</p>"),
    { mimeType: "multipart/related", parts: [part("text/plain", "Preferred plain"), part("image/png", "invalid binary")] },
  ] }), "fixture1");
  assert.equal(value.contentText, "Preferred plain");
});

test("Google refresh grant request/response contract (mock) validates safely", async () => {
  let reject = false, checked = false;
  const oauth = load("src/lib/google/data-oauth.ts", {}, {
    process: { env: { GOOGLE_DATA_CLIENT_ID: "synthetic-client", GOOGLE_DATA_CLIENT_SECRET: "synthetic-secret", GOOGLE_DATA_REDIRECT_URI: "http://localhost:3000/api/v1/connections/google/callback" } },
    async fetch(url, init) {
      checked = true;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(init.body.get("grant_type"), "refresh_token");
      return reject ? Response.json({ error: "private-provider-error" }, { status: 400 }) : Response.json({ access_token: "synthetic-refreshed", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.readonly" });
    },
  });
  const value = await oauth.refreshGoogleAccessToken("synthetic-refresh");
  assert.equal(value.refreshToken, null); assert.equal(checked, true);
  reject = true;
  await assert.rejects(oauth.refreshGoogleAccessToken("synthetic-refresh"), /TOKEN_REFRESH_FAILED/);
});

test("Gmail HTTP failure does not expose provider response or credentials", async () => {
  const h = gmailHarness({ response() { return Response.json({ error: "private-provider-error" }, { status: 503 }); } });
  const client = await h.api.createGmailClient("owner", "connection");
  await assert.rejects(client.list(), (error) => error.code === "GMAIL_UNAVAILABLE" && !error.message.includes("private"));
});

test("missing headers work; encoded Subject and case-insensitive headers decode; source date is internalDate", () => {
  const first = parser.mapGmailMessage(message(), "fixture1");
  assert.equal(first.title, "(제목 없음)");
  const value = parser.mapGmailMessage(message("fixture1", part("text/plain", "test", { headers: [
    { name: "sUbJeCt", value: `=?UTF-8?B?${Buffer.from("제목").toString("base64")}?=` },
    { name: "FROM", value: "Fixture <test@example.invalid>" }, { name: "Date", value: "untrusted date header" },
  ] })), "fixture1");
  assert.equal(value.title, "제목");
  assert.equal(value.metadata.from, "Fixture <test@example.invalid>");
  assert.equal(value.sourceCreatedAt, new Date(1791057600000).toISOString());
  assert.throws(() => parser.mapGmailMessage(message(), "different"));
  assert.throws(() => parser.mapGmailMessage({ ...message(), internalDate: "bad" }, "fixture1"));
  assert.throws(() => parser.mapGmailMessage(message("fixture1", part("text/plain", "", { body: { data: "$invalid" } })), "fixture1"));
});

function gmailHarness({ expired = false, missing = false, refreshFails = false, unauthorized = false, response } = {}) {
  const requests = [], saved = [], credentialAccess = [];
  let refreshCount = 0;
  const connections = {
    async getGoogleConnectionTokens(user, connection, access) { credentialAccess.push(access); assert.equal(user, "owner"); assert.equal(connection, "connection"); return missing ? null : {
      accessToken: saved.at(-1)?.accessToken ?? "synthetic-old", refreshToken: "synthetic-refresh",
      accessTokenCiphertext: saved.length ? "synthetic-new-cipher" : "synthetic-old-cipher",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      expiresAt: new Date(Date.now() + (expired && !saved.length ? -1 : 3600000)).toISOString() }; },
    async refreshGoogleConnectionTokens(user, connection, values, access) { credentialAccess.push(access); assert.equal(user, "owner"); assert.equal(connection, "connection"); saved.push(values); return true; },
  };
  const api = load("src/lib/google/gmail-client.ts", {
    "@/lib/google/connections": connections, "@/lib/google/gmail-message": parser,
    "@/lib/google/data-oauth": { async refreshGoogleAccessToken() { refreshCount++; if (refreshFails) throw new Error("synthetic-private-error"); return { accessToken: "synthetic-new", refreshToken: null, tokenExpiresAt: new Date(Date.now() + 3600000).toISOString() }; } },
  }, { async fetch(url, init) {
    const parsed = new URL(url); requests.push(parsed);
    assert.equal(parsed.origin, "https://gmail.googleapis.com");
    assert.ok(!parsed.pathname.includes("attachments"));
    assert.equal(init.cache, "no-store");
    if (unauthorized && init.headers.Authorization === "Bearer synthetic-old") return new Response("{}", { status: 401 });
    return response ? response(parsed, requests.length) : Response.json({ historyId: "100" });
  } });
  return { api, requests, saved, credentialAccess, refreshCount: () => refreshCount };
}

test("scheduled Gmail credential reads and refresh retain the same owner-bound lease", async () => {
  const h=gmailHarness({expired:true}); const client=await h.api.createGmailClient("owner","connection",{syncLeaseToken:"synthetic-lease"});
  await client.profile(); assert.equal(h.refreshCount(),1);
  assert.ok(h.credentialAccess.length>=3);assert.ok(h.credentialAccess.every(value=>value?.syncLeaseToken==="synthetic-lease"));
});

test("expired access refreshes once, stores via RPC boundary, concurrent callers share refreshed token", async () => {
  const h = gmailHarness({ expired: true });
  const client = await h.api.createGmailClient("owner", "connection");
  await Promise.all([client.profile(), client.profile(), client.profile()]);
  assert.equal(h.refreshCount(), 1);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].refreshToken, null);
});

test("401 refresh retry works; missing token/failed refresh are sanitized and don't call Gmail", async () => {
  const retry = gmailHarness({ unauthorized: true });
  await (await retry.api.createGmailClient("owner", "connection")).profile();
  assert.equal(retry.refreshCount(), 1); assert.equal(retry.requests.length, 2);
  const missing = gmailHarness({ missing: true });
  await assert.rejects(missing.api.createGmailClient("owner", "connection"), /TOKEN_MISSING/);
  const failed = gmailHarness({ expired: true, refreshFails: true });
  await assert.rejects((await failed.api.createGmailClient("owner", "connection")).profile(), /REFRESH_FAILED/);
  assert.equal(failed.requests.length, 0);
});

test("fixed query, pagination, unique IDs, hard 100 cap and per-message full GET only", async () => {
  const h = gmailHarness({ response(url, count) {
    if (url.pathname.endsWith("messages")) {
      assert.equal(url.searchParams.get("q"), "in:inbox newer_than:30d");
      const start = count === 1 ? 0 : 50;
      assert.equal(url.searchParams.get("maxResults"), String(100 - start));
      return Response.json({ messages: Array.from({ length: 50 }, (_, i) => ({ id: `mail${start + i}` })), nextPageToken: `page${count}` });
    }
    assert.equal(url.searchParams.get("format"), "full");
    return Response.json(message("mail0"));
  } });
  const client = await h.api.createGmailClient("owner", "connection");
  const listed = await client.list();
  assert.equal(listed.ids.length, 100); assert.equal(listed.capped, true);
  await client.message("mail0");
  assert.equal(h.requests.length, 3);
});

function collectionHarness({ status = "connected", foreign = false, failMessage = false, missingConnection = false, candidateFailure = false, capped = false } = {}) {
  const items = [], calls = [];
  let stamp = 0, baselineWrites = 0;
  const connection = { id: "connection", user_id: "owner", provider: "google", status, scopes:["https://www.googleapis.com/auth/gmail.readonly"], updated_at: "initial", sync_state: { gmail: { history_id: "90" }, retained: true } };
  function db() {
    return { from(table) {
      let operation = "read", values, filters = [], list = false;
      const query = {
        select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
        insert(value) { operation = "insert"; values = value; return query; },
        update(value) { operation = "update"; values = value; return query; },
        in(key, value) { filters.push([key, value]); return query; },
        limit() { list = true; return query; },
        async maybeSingle() { return execute(); }, then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        calls.push({ table, operation, filters, values });
        if (operation !== "insert") assert.ok(filters.some(([key, value]) => key === "user_id" && value === "owner"));
        const matches = (row) => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
        if (table === "items" && list) return candidateFailure ? { data: null, error: { code: "synthetic" } } : { data: items.filter(matches).map(r => ({ ...r })), error: null };
        if (table === "connections") {
          if (foreign || !matches(connection)) return { data: list ? [] : null, error: null };
          if (list) return { data: [{ ...connection }], error: null };
          if (operation === "update") { Object.assign(connection, values, { updated_at: `stamp${++stamp}` }); baselineWrites++; }
          return { data: { ...connection }, error: null };
        }
        if (operation === "insert") {
          assert.equal(values.user_id, "owner");
          if (items.some((row) => row.external_id === values.external_id && row.connection_id === values.connection_id)) return { error: { code: "23505" } };
          items.push({ ...values, id: `item${items.length}`, updated_at: `stamp${++stamp}` });
          return { error: null };
        }
        const found = items.find(matches);
        if (found && operation === "update") Object.assign(found, values, { updated_at: `stamp${++stamp}` });
        return { data: found ? { ...found } : null, error: null };
      }
      return query;
    } };
  }
  const client = db();
  const errors = gmailHarness().api;
  const collection = load("src/lib/google/gmail-collection.ts", {
    "@/lib/supabase/auth": { async requireUser() { return { id: "owner" }; } },
    "@/lib/supabase/server": { async createClient() { return client; } },
    "@/lib/supabase/admin": { createAdminClient() { return client; } },
    "@/lib/google/connections": { async getGoogleConnectionSummary() { return missingConnection ? null : { id: "connection", status }; } },
    "@/lib/google/gmail-message": parser,
    "@/lib/google/gmail-client": { ...errors, async createGmailClient() { return {
      async profile() { return "100"; }, async list() { return { ids: ["fixture1", "fixture2"], capped }; },
      async message(id) { if (failMessage && id === "fixture2") throw new Error("synthetic-private-message-error"); return message(id); },
    }; } },
  }, { process: { env: { GEMINI_MODEL: "gemini-fixture" } } });
  return { collection, client, items, connection, calls, baselineWrites: () => baselineWrites };
}

test("scheduled collector uses only its explicit owner and preserves normal collection semantics", async () => {
  const h = collectionHarness();
  const result = await h.collection.collectScheduledGmail("owner","synthetic-lease");
  assert.equal(result.complete, true); assert.equal(result.created_count, 2);
  assert.equal(h.items.length, 2); assert.ok(h.items.every(row => row.user_id === "owner"));
  const disconnected = collectionHarness({status:"disconnected"});
  await assert.rejects(disconnected.collection.collectScheduledGmail("owner","synthetic-lease"), /CONNECTION_REQUIRED/);
  assert.equal(disconnected.items.length, 0);
});

test("capped Gmail scans preserve prior success checkpoint and report partial", async () => {
  const h=collectionHarness({capped:true}), result=await h.collection.collectScheduledGmail("owner","synthetic-lease");
  assert.equal(result.capped,true);assert.equal(result.complete,false);assert.equal(h.baselineWrites(),0);
  assert.equal(h.connection.sync_state.gmail.history_id,"90");assert.equal(h.items.length,2);
});

test("Gmail committed collection offers only current-run unanalysed IDs; analysed skips and discovery failure keeps success", async () => {
  const h = collectionHarness(), p = load("src/lib/items/analysis-policy.ts");
  const first = await h.collection.collectInitialGmail(); assert.equal(first.analysisItemIds.length, 2);
  for (const item of h.items) item.metadata.aiAnalysis = { schemaVersion: "0.2", model: "gemini-fixture", inputFingerprint: p.analysisFingerprint(item.content_text, "gemini-fixture", "0.2") };
  assert.equal((await h.collection.collectInitialGmail()).analysisItemIds.length, 0);
  const failed = await collectionHarness({ candidateFailure: true }).collection.collectInitialGmail();
  assert.equal(failed.complete, true); assert.equal(failed.analysisDiscoveryFailed, true); assert.equal(failed.created_count, 2);
});

test("collection creates queued Gmail ITEM; rerun skips; raw update preserves processing and metadata", async () => {
  const h = collectionHarness();
  let result = await h.collection.collectInitialGmail();
  assert.equal(result.created_count, 2); assert.equal(result.failed_count, 0);
  assert.equal(h.items[0].external_container_id, null);
  assert.equal(h.items[0].metadata.threadId, "threadfixture");
  assert.equal(h.items[0].processing_status, "queued");
  assert.equal(h.items[0].format, "email");
  h.items[0].processing_status = "completed";
  h.items[0].metadata.custom = "preserve";
  result = await h.collection.collectInitialGmail();
  assert.equal(result.skipped_count, 2); assert.equal(h.items.length, 2);
  const changed = parser.mapGmailMessage(message("fixture1", part("text/plain", "changed")), "fixture1");
  assert.equal(await h.collection.saveGmailItem(h.client, "owner", "connection", changed), "updated");
  assert.equal(h.items[0].processing_status, "completed");
  assert.equal(h.items[0].metadata.custom, "preserve");
  assert.equal(h.connection.sync_state.retained, true);
  assert.equal(h.connection.sync_state.gmail.initial_collection.history_id, "100");
});

test("racing first inserts reselect after 23505 and produce one ITEM", async () => {
  const h = collectionHarness();
  const mapped = parser.mapGmailMessage(message(), "fixture1");
  const results = await Promise.all([h.collection.saveGmailItem(h.client, "owner", "connection", mapped), h.collection.saveGmailItem(h.client, "owner", "connection", mapped)]);
  assert.equal(h.items.length, 1);
  assert.deepEqual(results.sort(), ["created", "skipped"]);
});

test("partial get failure preserves successful ITEM and does not advance baseline", async () => {
  const h = collectionHarness({ failMessage: true });
  const result = await h.collection.collectInitialGmail();
  assert.equal(result.created_count, 1); assert.equal(result.failed_count, 1); assert.equal(result.complete, false);
  assert.equal(h.baselineWrites(), 0); assert.equal(h.connection.sync_state.gmail.history_id, "90");
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("disconnected/foreign connection rejected before Gmail and ITEM writes", async () => {
  for (const options of [{ missingConnection: true }, { status: "disconnected" }, { foreign: true }]) {
    const h = collectionHarness(options);
    await assert.rejects(h.collection.collectInitialGmail(), /CONNECTION_REQUIRED/);
    assert.equal(h.items.length, 0); assert.equal(h.baselineWrites(), 0);
  }
});

test("collection API rejects cross-origin, sanitizes refresh/provider failures, no credential output", async () => {
  const errors = gmailHarness().api;
  const http = { connectionResponse(value, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }, connectionErrorResponse() { return Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 }); } };
  const route = load("src/app/api/v1/connections/google/sync/route.ts", {
    "@/lib/google/gmail-collection": { async collectInitialGmail() { throw new errors.GmailCollectionError("REFRESH_FAILED"); } },
    "@/lib/google/gmail-client": errors, "@/lib/google/http": http,
  });
  assert.equal((await route.POST(new Request("http://localhost/api/v1/connections/google/sync", { method: "POST", headers: { Origin: "https://foreign.invalid" } }))).status, 403);
  const response = await route.POST(new Request("http://localhost/api/v1/connections/google/sync", { method: "POST", headers: { Origin: "http://localhost" } }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "REFRESH_FAILED");
});
