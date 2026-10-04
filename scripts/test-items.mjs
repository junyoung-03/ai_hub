// Isolated read-contract tests. Fixtures are in memory; no real DB writes or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as crypto from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports, URL, URLSearchParams, Buffer, Response, Headers,
    require(name) {
      if (name === "server-only") return {};
      if (name in dependencies) return dependencies[name];
      if (name === "node:crypto") return crypto;
      if (name === "next/server") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const database = load("src/types/database.ts");
const filters = load("src/lib/items/filters.ts", { "@/types/database": database });
const presentation = load("src/lib/items/presentation.ts");
const classify = {
  ai_primary_topic: "AI Topic", user_primary_topic: null, ai_document_type: "notice", user_document_type: null,
  ai_tags: ["AI tag"], user_tags: null,
};
const id = "10000000-0000-4000-8000-000000000001";
const otherItemId = "10000000-0000-4000-8000-000000000002";
const actionId = "20000000-0000-4000-8000-000000000001";
const time = "2026-10-03T10:00:00.123456+00:00";
const plain = (value) => JSON.parse(JSON.stringify(value));

function queries(responses, authorized = true) {
  const calls = [];
  let authChecks = 0;
  const client = createClient("https://db.invalid", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url) => {
      calls.push(new URL(url));
      const response = responses.shift();
      assert.ok(response, "Unexpected database request");
      return new Response(JSON.stringify(response.data), { status: response.status ?? 200, headers: { "content-type": "application/json" } });
    } },
  });
  const auth = { async requireUser() {
    authChecks++;
    if (!authorized) throw new Error("Authentication required");
    return { id: "owner-fixture" };
  } };
  const queryModule = load("src/lib/items/queries.ts", {
    "@/lib/supabase/auth": auth, "@/lib/supabase/server": { async createClient() { return client; } },
    "@/lib/items/filters": filters, "@/lib/items/presentation": presentation,
  });
  return { queryModule, calls, auth, checks: () => authChecks };
}

test("effective values use null fallback; empty user tags stay empty and User Edited", () => {
  assert.deepEqual(plain(presentation.effectiveClassification(classify).tags), ["AI tag"]);
  const result = presentation.effectiveClassification({ ...classify, user_primary_topic: "User Topic", user_document_type: "general", user_tags: [] });
  assert.equal(result.primaryTopic, "User Topic");
  assert.equal(result.documentType, "general");
  assert.deepEqual(plain(result.tags), []);
  assert.equal(result.origin, "user");
  assert.equal(result.origins.tags, "user");
  assert.equal(presentation.effectiveClassification(null).available, false);
});

test("filters reject ambiguous parameters, invalid enum/date/limit/cursor and client ownership", () => {
  assert.equal(filters.parseItemQuery(new URLSearchParams()).limit, 30);
  for (const value of ["source=unknown", "source=gmail&source=drive", "from=2026-02-30", "from=2026-10-04&to=2026-10-03", "limit=101", "limit=0", "limit=1.5", "cursor=bad", "user_id=other"]) {
    assert.throws(() => filters.parseItemQuery(new URLSearchParams(value)), filters.InvalidItemQueryError);
  }
});

test("cursor preserves microseconds and is bound to the filter/limit; next link keeps all filters", () => {
  const input = filters.parseItemQuery(new URLSearchParams("source=gmail&topic=등록금&limit=1"));
  const cursor = filters.encodeCursor({ id, createdAt: time }, input);
  const link = new URL(filters.libraryUrl(input, cursor), "http://localhost");
  const parsed = filters.parseItemQuery(link.searchParams);
  assert.equal(parsed.position.createdAt, time);
  assert.equal(parsed.position.id, id);
  assert.equal(link.searchParams.get("topic"), "등록금");
  link.searchParams.set("source", "drive");
  assert.throws(() => filters.parseItemQuery(link.searchParams), filters.InvalidItemQueryError);
});

test("list keeps unclassified items and reads only the verified owner's rows, with bounded stable ordering", async () => {
  const { queryModule, calls } = queries([{ data: [{ id, title: "Fixture", source: "manual", format: "text", processing_status: "completed", created_at: time, classification: [] }] }]);
  const result = await queryModule.listItems(filters.parseItemQuery(new URLSearchParams()));
  assert.equal(result.items[0].classification.available, false);
  assert.equal(result.nextCursor, null);
  const params = calls[0].searchParams;
  assert.equal(params.get("user_id"), "eq.owner-fixture");
  assert.equal(params.get("limit"), "31");
  assert.equal(params.get("order"), "created_at.desc,id.desc");
  assert.equal(params.get("offset"), null);
  assert.ok(!params.get("select").includes("!inner"));
});

test("effective filters use inner relationship and both override/fallback predicates; grammar is quoted", async () => {
  const topic = '공지),user_primary_topic.not.is.null,(x,"\\';
  const params = new URLSearchParams({ topic, documentType: "notice", from: "2026-10-01", to: "2026-10-03", source: "gmail", format: "email", processingStatus: "completed" });
  const { queryModule, calls } = queries([{ data: [] }]);
  await queryModule.listItems(filters.parseItemQuery(params));
  const wire = calls[0].searchParams;
  assert.ok(wire.get("select").includes("!inner"));
  const literal = '"공지),user_primary_topic.not.is.null,(x,\\"\\\\"';
  assert.equal(wire.get("classification.or"), `(and(or(user_primary_topic.eq.${literal},and(user_primary_topic.is.null,ai_primary_topic.eq.${literal})),or(user_document_type.eq."notice",and(user_document_type.is.null,ai_document_type.eq."notice"))))`);
  assert.equal(wire.get("created_at"), "gte.2026-10-01T00:00:00Z");
  assert.equal(wire.getAll("created_at")[1], "lt.2026-10-04T00:00:00.000Z");
  assert.equal(wire.get("source"), "eq.gmail");
  assert.equal(wire.get("processing_status"), "eq.completed");
});

test("pagination uses tie-breaking id and strict comparisons without rounding PG timestamps", async () => {
  const row = { id, title: "Fixture", source: "manual", format: "text", processing_status: "completed", created_at: time, classification: [classify] };
  const { queryModule, calls } = queries([{ data: [row, { ...row, id: otherItemId }] }, { data: [] }]);
  const input = filters.parseItemQuery(new URLSearchParams("limit=1"));
  const first = await queryModule.listItems(input);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  await queryModule.listItems(filters.parseItemQuery(new URLSearchParams({ limit: "1", cursor: first.nextCursor })));
  assert.equal(calls[1].searchParams.get("or"), `(created_at.lt."${time}",and(created_at.eq."${time}",id.lt.${id}))`);
});

test("detail joins 1 Action to multiple ITEM sources including history, without private storage fields", async () => {
  const { queryModule, calls } = queries([
    { data: { id, title: "Fixture", source: "upload", format: "pdf", processing_status: "completed", created_at: time, updated_at: time, content_text: "Fixture content", original_url: "https://private.invalid/path" } },
    { data: { ...classify, user_tags: [] } },
    { data: [{ action_id: actionId }, { action_id: actionId }] },
    { data: [{ id: actionId, title: "Fixture action", action_type: "required", status: "open", deadline_status: "none", deadline_date: null, deadline_at: null, deadline_source_id: null }] },
    { data: [
      { id: "evidence-1", action_id: actionId, item_id: id, evidence_text: "Current fixture", evidence_locator: { page: 1 }, is_current: true, observed_at: time },
      { id: "evidence-2", action_id: actionId, item_id: otherItemId, evidence_text: "History fixture", evidence_locator: {}, is_current: false, observed_at: time },
    ] },
  ]);
  const detail = await queryModule.getItemDetail(id);
  assert.equal(detail.actions.length, 1);
  assert.equal(detail.evidence.length, 2);
  assert.ok(detail.evidence.some((source) => source.itemId === otherItemId && !source.isCurrent));
  assert.equal(detail.original.url, null);
  assert.equal(detail.original.previewType, "upload");
  assert.equal(detail.item.storagePath, undefined);
  assert.deepEqual(plain(detail.classification.tags), []);
  for (const url of calls) assert.equal(url.searchParams.get("user_id"), "eq.owner-fixture");
  assert.equal(calls.at(-1).searchParams.get("item_id"), null);
  assert.equal(calls.at(-1).searchParams.get("action_id"), `in.(${actionId})`);
});

test("detail reads subsequent keyset pages when Evidence exceeds one database response", async () => {
  const source = (index) => ({ id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`, action_id: actionId, item_id: id, evidence_text: "Fixture", evidence_locator: {}, is_current: index === 501, observed_at: time });
  const firstPage = Array.from({ length: 500 }, (_, index) => source(index + 1));
  const { queryModule, calls } = queries([
    { data: { id, title: "Fixture", source: "manual", format: "text", processing_status: "completed", created_at: time, updated_at: time, content_text: "Fixture", original_url: null } },
    { data: null }, { data: [{ id: source(1).id, action_id: actionId }] },
    { data: [{ id: actionId, title: "Fixture", action_type: "check", status: "open", deadline_status: "none", deadline_date: null, deadline_at: null, deadline_source_id: null }] },
    { data: firstPage }, { data: [source(501)] },
  ]);
  const result = await queryModule.getItemDetail(id);
  assert.equal(result.evidence.length, 501);
  assert.equal(calls.at(-1).searchParams.get("id"), `gt.${source(500).id}`);
  assert.equal(calls.at(-1).searchParams.get("order"), "id.asc");
  assert.equal(calls.at(-1).searchParams.get("offset"), null);
  assert.ok(result.evidence.some((row) => row.isCurrent));
});

test("anonymous queries fail before DB requests; foreign/missing ITEM is indistinguishable", async () => {
  const anonymous = queries([], false);
  await assert.rejects(anonymous.queryModule.listItems(filters.parseItemQuery(new URLSearchParams())), /Authentication required/);
  await assert.rejects(anonymous.queryModule.getItemDetail(id), /Authentication required/);
  assert.equal(anonymous.calls.length, 0);
  const missing = queries([{ data: null }]);
  assert.equal(await missing.queryModule.getItemDetail(id), null);
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.calls[0].searchParams.get("user_id"), "eq.owner-fixture");
  assert.equal(await missing.queryModule.getItemDetail("invalid"), null);
  assert.equal(missing.calls.length, 1);
});

test("Gmail Detail exposes only approved headers/source date; private metadata stays private", async () => {
  const { queryModule } = queries([
    { data: { id, title: "Synthetic subject", source: "gmail", format: "email", processing_status: "queued", created_at: time, updated_at: time, source_created_at: time, content_text: "Synthetic body", original_url: null, metadata: { from: "fixture@example.invalid", to: "owner@example.invalid", date: "Fixture date", token: "private-secret-marker", threadId: "private-source-id" } } },
    { data: null }, { data: [] },
  ]);
  const result = await queryModule.getItemDetail(id);
  assert.equal(result.gmail.from, "fixture@example.invalid");
  assert.equal(result.item.sourceCreatedAt, time);
  assert.ok(!JSON.stringify(result).includes("private-secret-marker"));
  assert.ok(!JSON.stringify(result).includes("private-source-id"));
});

test("database errors do not leak provider details; external URLs allow HTTP(S) only without credentials", async () => {
  const { queryModule } = queries([{ data: { message: "private-db-detail", code: "XX000" }, status: 500 }]);
  await assert.rejects(queryModule.listItems(filters.parseItemQuery(new URLSearchParams())), (error) => error instanceof queryModule.ItemReadError && !error.message.includes("private-db-detail"));
  for (const url of ["javascript:alert(1)", "data:text/html,private", "//example.com", "https://name:password@example.com", "not-url"]) assert.equal(presentation.safeOriginalUrl(url), null);
  assert.equal(presentation.safeOriginalUrl("https://example.com/item"), "https://example.com/item");
  assert.deepEqual(plain(presentation.locatorLabels({ page: 3, hidden: "private", section: "일정", nested: { secret: "private" } })), ["페이지: 3", "구역: 일정"]);
});

test("GET API returns private no-store 401/400/404/500 envelopes without internal messages", async () => {
  class AuthenticationRequiredError extends Error {}
  const http = load("src/lib/items/http.ts", { "@/lib/supabase/auth": { AuthenticationRequiredError }, "@/lib/items/filters": filters });
  for (const [error, status, code] of [[new AuthenticationRequiredError(), 401, "UNAUTHORIZED"], [new filters.InvalidItemQueryError(), 400, "VALIDATION_ERROR"], [new Error("private-db-detail"), 500, "INTERNAL_ERROR"]]) {
    const response = http.itemErrorResponse(error);
    const value = await response.json();
    assert.equal(response.status, status);
    assert.equal(value.error.code, code);
    assert.ok(!value.error.message.includes("private-db-detail"));
    assert.match(response.headers.get("cache-control"), /private, no-store/);
  }
  assert.equal(http.itemNotFound().status, 404);
  const route = load("src/app/api/v1/items/route.ts", {
    "@/lib/supabase/auth": { async requireUser() { throw new AuthenticationRequiredError(); } },
    "@/lib/items/filters": filters, "@/lib/items/http": http,
    "@/lib/items/queries": { async listItems() { assert.fail("Anonymous must not read DB"); } },
  });
  assert.equal((await route.GET(new Request("http://localhost/api/v1/items?user_id=other"))).status, 401);
});
