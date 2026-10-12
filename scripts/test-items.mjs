// Isolated read-contract tests. Fixtures are in memory; no real DB writes or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as crypto from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { loadAnalysisModule } from "./analysis-loader.mjs";

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
      if (name === "@/lib/uploads/ocr-contract") return load("src/lib/uploads/ocr-contract.ts");
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
const calendarContract = load("src/lib/google/calendar-contract.ts");
// Local v0.2 validation only. Importing a Gemini client would fail this harness.
const validation = loadAnalysisModule("src/lib/gemini/validation.ts");
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
    "@/lib/google/calendar-contract": calendarContract,
    "@/lib/uploads/contract": load("src/lib/uploads/contract.ts"),
    "@/lib/gemini/validation": validation,
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

test("Library source tabs return to all without serializing undefined filters", () => {
  for (const source of database.Constants.public.Enums.item_source) {
    const input = filters.parseItemQuery(new URLSearchParams({ source }));
    const url = filters.libraryUrl({ ...input, filters: { ...input.filters, source: undefined } });
    assert.equal(url, "/library");
    assert.deepEqual(plain(filters.parseItemQuery(new URL(url, "http://localhost").searchParams).filters), {});
  }

  const input = filters.parseItemQuery(new URLSearchParams("source=calendar&topic=공지&processingStatus=completed&limit=10"));
  const cursor = filters.encodeCursor({ id, createdAt: time }, input);
  const page = filters.parseItemQuery(new URLSearchParams(new URL(filters.libraryUrl(input, cursor), "http://localhost").search));
  const link = new URL(filters.libraryUrl({ ...page, filters: { ...page.filters, source: undefined } }), "http://localhost");
  assert.equal(link.searchParams.has("source"), false);
  assert.equal(link.searchParams.has("cursor"), false);
  const parsed = filters.parseItemQuery(link.searchParams);
  assert.deepEqual(plain(parsed.filters), { processingStatus: "completed", topic: "공지" });
  assert.equal(parsed.limit, 10);
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
  assert.equal(result.calendar, null);
  assert.equal(result.item.sourceCreatedAt, time);
  assert.ok(!JSON.stringify(result).includes("private-secret-marker"));
  assert.ok(!JSON.stringify(result).includes("private-source-id"));
});

test("Calendar Detail GET projects original date fields only without creating AI/Action data", async () => {
  const metadata = { calendar: { calendarId: "primary", extractionVersion: "calendar-text-v1", status: "cancelled", eventType: "default",
    start: { date: "2026-10-05", secret: "private-secret-marker" }, end: { date: "2026-10-07" },
    calendarTimezone: "Asia/Seoul", eventTimezone: null, allDay: true, endTimeUnspecified: false,
    location: "Synthetic room", recurringEventId: "master1", originalStartTime: { date: "2026-10-05" },
    attendees: [{ email: "private-secret-marker" }], credentials: "private-secret-marker" }, raw: "private-secret-marker" };
  const { queryModule, calls } = queries([
    { data: { id, title: "Synthetic event", source: "calendar", format: "calendar_event", processing_status: "queued",
      created_at: time, updated_at: time, content_text: "Synthetic text", original_url: "https://calendar.google.com/calendar/event?eid=synthetic", metadata } },
    { data: null }, { data: [] },
  ]);
  const result = await queryModule.getItemDetail(id);
  assert.equal(result.calendar.start.date, "2026-10-05"); assert.equal(result.calendar.end.date, "2026-10-07");
  assert.equal(result.calendar.status, "cancelled"); assert.equal(result.calendar.allDay, true);
  assert.equal(result.gmail, null); assert.equal(result.aiAnalysis, null); assert.equal(result.eventObservations.length, 0);
  assert.equal(result.actions.length, 0); assert.equal(result.evidence.length, 0);
  assert.ok(!JSON.stringify(result).includes("private-secret-marker"));
  for (const call of calls) assert.equal(call.searchParams.get("user_id"), "eq.owner-fixture");
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

const detailItem = {
  id, title: "Synthetic subject", source: "gmail", format: "email", processing_status: "indexing",
  created_at: time, updated_at: time, source_created_at: time, content_text: "행사일은 2026-10-20입니다.", original_url: null,
};
test("Upload Detail uses existing owner read path with safe page map and no private metadata",async()=>{
  const uploadContract=load("src/lib/uploads/contract.ts"),extraction=uploadContract.assemble([{text:"Synthetic text",method:"ocr",confidence:0.01}]);
  const item={...detailItem,source:"upload",format:"image",processing_status:"queued",content_text:extraction.text,metadata:{secret:"private-upload-marker",upload:{rawHash:"private-upload-marker",storagePath:"private-upload-marker",extraction:{...extraction,rawResponse:"private-upload-marker"}}}};
  const {queryModule}=queries([{data:item},{data:null},{data:[]}]);const result=await queryModule.getItemDetail(id);
  assert.equal(result.upload.extractionStatus,"complete");assert.equal(result.upload.pages[0].end,14);
  assert.equal(result.original.url,null);assert.equal(result.original.previewType,"upload");assert.equal(result.actions.length,0);assert.equal(result.aiAnalysis,null);
  assert.ok(!JSON.stringify(result).includes("private-upload-marker"));
});
const detailAction = {
  id: actionId, title: "신청하세요", action_type: "optional", status: "completed",
  deadline_status: "confirmed", deadline_date: "2026-10-15", deadline_at: "2026-10-15T18:00:00+09:00",
  deadline_source_id: "source-fixture", requirements: ["신청서"], conditions: ["대상자"],
  start_date: "2026-10-05", start_at: null, completed_at: time,
};
const eventQuote = {
  text: detailItem.content_text,
  locator: { kind: "text_span", page: null, section: null, startChar: 0,
    endChar: Array.from(detailItem.content_text).length, field: "content_text" },
};
const artifact = {
  schemaVersion: "0.2", analyzedAt: time, model: "private-model-marker", inputFingerprint: "private-fingerprint-marker",
  result: { schemaVersion: "0.2", classification: { primaryTopic: "행사", documentType: "schedule", tags: [] },
    actions: [], eventObservations: [{ status: "confirmed", date: "2026-10-20", datetime: null,
      rawText: "2026-10-20", evidence: eventQuote }] },
};
function detailResponses(item = detailItem, classification = classify, action = null, sources = []) {
  return [{ data: item }, { data: classification }, { data: action ? [{ id: "source-fixture", action_id: action.id }] : [] },
    ...(action ? [{ data: [action] }, { data: sources }] : [])];
}

test("Detail GET serializes the approved contract, with AI/User/Effective values and legacy fields", async () => {
  const edited = { ...classify, user_primary_topic: "User Topic", user_document_type: null, user_tags: [] };
  const { queryModule, calls } = queries(detailResponses(detailItem, edited, detailAction));
  const http = load("src/lib/items/http.ts", { "@/lib/supabase/auth": { AuthenticationRequiredError: class extends Error {} }, "@/lib/items/filters": filters });
  const route = load("src/app/api/v1/items/[itemId]/route.ts", { "@/lib/items/http": http, "@/lib/items/queries": queryModule });
  const response = await route.GET(new Request(`http://localhost/api/v1/items/${id}`), { params: Promise.resolve({ itemId: id }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  const result = await response.json();
  for (const field of ["item", "classification", "actions", "evidence", "processing", "gmail", "original",
    "aiClassification", "userClassification", "effectiveClassification", "eventObservations", "aiAnalysis"]) assert.ok(Object.hasOwn(result, field), field);
  assert.deepEqual(result.aiClassification, { primaryTopic: "AI Topic", documentType: "notice", tags: ["AI tag"] });
  assert.deepEqual(result.userClassification, { primaryTopic: "User Topic", documentType: null, tags: [] });
  assert.deepEqual(result.classification, result.effectiveClassification);
  assert.equal(result.effectiveClassification.primaryTopic, "User Topic");
  assert.equal(result.effectiveClassification.documentType, "notice");
  assert.deepEqual(result.effectiveClassification.tags, []);
  assert.deepEqual(result.effectiveClassification.origins, { primaryTopic: "user", documentType: "ai", tags: "user" });
  const action = result.actions[0];
  assert.deepEqual(action.requirements, ["신청서"]);
  assert.deepEqual(action.conditions, ["대상자"]);
  assert.equal(action.startDate, "2026-10-05");
  assert.equal(action.startAt, null);
  assert.equal(action.deadlineDate, "2026-10-15");
  assert.equal(action.deadlineAt, "2026-10-15T18:00:00+09:00");
  assert.equal(action.deadlineStatus, "confirmed");
  assert.equal(action.deadlineSourceId, "source-fixture");
  assert.equal(action.status, "completed");
  assert.equal(action.completedAt, time);
  assert.equal(result.item.processingStatus, "indexing");
  assert.equal(result.processing.status, "indexing");
  assert.equal(result.aiAnalysis, null);
  for (const call of calls) assert.equal(call.searchParams.get("user_id"), "eq.owner-fixture");
  assert.ok(calls[3].searchParams.get("select").includes("requirements,conditions,start_date,start_at,completed_at"));
});

test("unanalysed and AI-only ITEMs return safe empty states without creating Actions or overrides", async () => {
  for (const classification of [null, classify]) {
    const { queryModule } = queries(detailResponses({ ...detailItem, processing_status: "queued" }, classification));
    const result = plain(await queryModule.getItemDetail(id));
    assert.equal(result.userClassification, null);
    assert.equal(result.aiClassification === null, classification === null);
    assert.equal(result.effectiveClassification.available, classification !== null);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.evidence, []);
    assert.deepEqual(result.eventObservations, []);
    assert.equal(result.aiAnalysis, null);
    assert.equal(result.processing.status, "queued");
  }
});

test("v0.2 event-only analysis exposes a safe summary and event Evidence without changing Action deadlines", async () => {
  for (const action of [null, detailAction]) {
    const { queryModule } = queries(detailResponses({ ...detailItem, metadata: { aiAnalysis: artifact, token: "private-token-marker" } }, classify, action));
    const result = plain(await queryModule.getItemDetail(id));
    assert.deepEqual(result.aiAnalysis, { schemaVersion: "0.2", analyzedAt: time });
    assert.equal(result.eventObservations.length, 1);
    assert.equal(result.eventObservations[0].date, "2026-10-20");
    assert.deepEqual(result.eventObservations[0].evidence, eventQuote);
    assert.equal(result.actions.length, action ? 1 : 0);
    if (action) {
      assert.equal(result.actions[0].startDate, "2026-10-05");
      assert.equal(result.actions[0].deadlineDate, "2026-10-15");
    }
    assert.equal(result.aiClassification.primaryTopic, "AI Topic", "Stored DB classification wins over artifact candidate");
    const serialized = JSON.stringify(result);
    for (const marker of ["private-token-marker", "private-model-marker", "private-fingerprint-marker"]) assert.ok(!serialized.includes(marker));
    assert.ok(!Object.hasOwn(result.item, "metadata"));
    assert.equal(result.processing.status, "indexing");
  }
});

test("needs_review events remain undated; valid empty analysis is distinguishable from missing analysis", async () => {
  for (const events of [[], [{ status: "needs_review", date: null, datetime: null, rawText: "2026-10-20", evidence: eventQuote }]]) {
    const stored = { ...artifact, result: { ...artifact.result, eventObservations: events } };
    const { queryModule } = queries(detailResponses({ ...detailItem, metadata: { aiAnalysis: stored } }));
    const result = plain(await queryModule.getItemDetail(id));
    assert.deepEqual(result.aiAnalysis, { schemaVersion: "0.2", analyzedAt: time });
    assert.deepEqual(result.eventObservations, events);
    assert.deepEqual(result.actions, []);
  }
});

test("missing/malformed/obsolete/stale AI artifacts fail safely without failing Detail", async () => {
  const malformed = [null, [], "bad", {}, { ...artifact, schemaVersion: "0.1" },
    { ...artifact, analyzedAt: "not-a-time" }, { ...artifact, result: {} },
    { ...artifact, result: { ...artifact.result, schemaVersion: "0.1" } },
    { ...artifact, result: { ...artifact.result, eventObservations: "bad" } },
    { ...artifact, result: { ...artifact.result, eventObservations: [{ ...artifact.result.eventObservations[0], evidence: null }] } },
    { ...artifact, result: { ...artifact.result, eventObservations: [{ ...artifact.result.eventObservations[0], rawText: "추론된 날짜" }] } },
    { ...artifact, result: { ...artifact.result, arbitrary: "private-nested-marker" } },
  ];
  for (const stored of malformed) {
    const { queryModule } = queries(detailResponses({ ...detailItem, metadata: { aiAnalysis: stored } }, classify, detailAction));
    const result = plain(await queryModule.getItemDetail(id));
    assert.equal(result.aiAnalysis, null);
    assert.deepEqual(result.eventObservations, []);
    assert.equal(result.actions[0].id, actionId);
    assert.equal(result.classification.primaryTopic, "AI Topic");
    assert.ok(!JSON.stringify(result).includes("private-nested-marker"));
  }
  const { queryModule } = queries(detailResponses({ ...detailItem, content_text: "Changed source", metadata: { aiAnalysis: artifact } }));
  assert.equal((await queryModule.getItemDetail(id)).aiAnalysis, null);
});

test("Evidence maps observed deadlines and recursively whitelists persisted locator keys including history", async () => {
  const quote = { ...eventQuote, token: "nested-secret-marker", locator: { ...eventQuote.locator, analysisKey: "nested-key-marker" } };
  const observation = { status: "confirmed", date: "2026-10-20", datetime: null, rawText: "2026-10-20", evidence: quote, arbitrary: "nested-secret-marker" };
  const source = {
    id: "source-fixture", action_id: actionId, item_id: id, evidence_text: eventQuote.text,
    evidence_locator: { ...eventQuote.locator, schemaVersion: "0.2", analysisKey: "internal-key-marker",
      token: "outer-secret-marker", evidence: [quote], startObservation: observation,
      deadlineObservation: { status: "none", date: null, datetime: null, rawText: null, evidence: null, token: "nested-secret-marker" } },
    is_current: true, observed_at: time, observed_deadline_date: "2026-10-15", observed_deadline_at: null,
  };
  const { queryModule, calls } = queries(detailResponses(detailItem, classify, detailAction, [source,
    { ...source, id: "history-fixture", item_id: otherItemId, is_current: false, evidence_locator: { page: 1, private: "outer-secret-marker" } }]));
  const result = plain(await queryModule.getItemDetail(id));
  const current = result.evidence.find((row) => row.isCurrent);
  assert.equal(current.text, eventQuote.text);
  assert.equal(current.observedDeadlineDate, "2026-10-15");
  assert.equal(current.observedDeadlineAt, null);
  assert.deepEqual(current.locator.evidence, [eventQuote]);
  assert.deepEqual(current.locator.startObservation, { status: "confirmed", date: "2026-10-20", datetime: null,
    rawText: "2026-10-20", evidence: eventQuote });
  assert.deepEqual(current.locator.deadlineObservation, { status: "none", date: null, datetime: null, rawText: null, evidence: null });
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.evidence.find((row) => !row.isCurrent).locator, { page: 1 });
  for (const marker of ["nested-secret-marker", "nested-key-marker", "internal-key-marker", "outer-secret-marker"]) assert.ok(!JSON.stringify(result).includes(marker));
  assert.equal(calls.at(-1).searchParams.get("user_id"), "eq.owner-fixture");
});

test("malformed locator values are omitted without exposing arbitrary JSON", () => {
  for (const input of [null, [], "bad", { private: { token: "marker" } }]) assert.deepEqual(plain(presentation.safeEvidenceLocator(input)), {});
  const result = plain(presentation.safeEvidenceLocator({ schemaVersion: "0.2", kind: "invalid", page: -1, startChar: "marker",
    evidence: [{ text: "invented", locator: {} }], startObservation: { status: "confirmed", date: "2026-02-30" },
    deadlineObservation: { status: "none", date: "2026-10-20", datetime: null, rawText: null, evidence: null } }));
  assert.deepEqual(result, { schemaVersion: "0.2", evidence: [] });
});
