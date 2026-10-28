import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { uiLoader } from "./helpers/content-ui-loader.mjs";

const require = createRequire(import.meta.url);
const ui = uiLoader();
const { summarizeProcessing, processingErrorMessage } = ui("src/lib/items/processing.ts");
const { analysisEligible } = ui("src/lib/items/analysis-policy.ts");
const { parseItemQuery } = ui("src/lib/items/filters.ts");
const id = "10000000-0000-4000-8000-000000000001", foreign = "20000000-0000-4000-8000-000000000002";
const time = "2026-10-27T00:00:00Z";
const raw = (extra = {}) => ({ id, source: "gmail", format: "email", content_text: "Synthetic body", metadata: {}, processing_status: "queued", processing_error: null, updated_at: time, ...extra });
const summary = (item, job) => summarizeProcessing(item, analysisEligible(item), job);
const job = { itemId: id, state: "pending", leaseUntil: null, availableAt: time, schedulerAvailable: true };
const snapshot = status => [{ id, processing: summary(raw({ processing_status: status }), status === "analyzing" ? { ...job, state: "running", leaseUntil: "2100-01-01T00:00:00Z" } : job) }];
const plain = value => JSON.parse(JSON.stringify(value));

test("Library defaults to every status for the former presentation account; reset also clears status", async () => {
  const queries = [];
  const load = uiLoader({
    "@/lib/supabase/auth": { requirePageUser: async () => ({ id: "c05fdc30-bf78-4922-b2bb-af576b3af270" }) },
    "@/lib/items/queries": { listItems: async query => { queries.push(query); return { items: [], nextCursor: null }; } },
    "@/components/shell/app-shell": { AppShell: ({ children }) => React.createElement("main", {}, children) },
    "@/components/uploads/upload-controls": { UploadControls: () => null },
    "@/components/items/manual-text-controls": { ManualTextControls: () => null },
    "@/components/library/material-focus": { MaterialFocus: () => null },
    "@/components/items/processing-refresh": { ProcessingRefresh: () => null },
  });
  const Page = load("src/app/library/page.tsx").default;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.ok(queries.length > 0);
  assert.ok(queries.every(query => query.filters.processingStatus === undefined));
  assert.match(html, /모든 처리 상태/);
  const { LibraryToolbar } = ui("src/components/library/library-toolbar.tsx");
  const filtered = renderToStaticMarkup(React.createElement(LibraryToolbar, { query: parseItemQuery(new URLSearchParams("source=gmail&processingStatus=completed")) }));
  assert.match(filtered, /<option value="completed" selected="">완료<\/option>/);
  const reset = filtered.match(/href="([^"]+)" class="underline">조건 해제/)[1];
  assert.equal(reset, "/library?source=gmail");
  queries.length = 0;
  await Page({ searchParams: Promise.resolve({ source: "gmail" }) });
  assert.ok(queries.every(query => query.filters.processingStatus === undefined && query.filters.source === "gmail"));
});

test("status selection has exactly one successful form control and includes all persisted states", () => {
  const { LibraryToolbar } = ui("src/components/library/library-toolbar.tsx");
  const html = renderToStaticMarkup(React.createElement(LibraryToolbar, { query: parseItemQuery(new URLSearchParams("processingStatus=failed&source=drive")) }));
  assert.equal((html.match(/name="processingStatus"/g) ?? []).length, 1);
  for (const status of ["uploaded", "queued", "extracting", "analyzing", "indexing", "completed", "failed"]) assert.match(html, new RegExp(`option value="${status}"`));
  assert.match(html, /name="source" value="drive"/);
});

test("legacy queued items without text and Calendar items cannot analyze or poll", () => {
  for (const item of [raw({ content_text: null }), raw({ content_text: " \n " }), raw({ source: "calendar", format: "calendar_event" }), raw({ source: "drive", format: "pdf" }), raw({ content_text: "x".repeat(200001) })]) {
    const value = summary(item, job);
    assert.equal(value.canAnalyze, false); assert.equal(value.canPoll, false);
  }
  assert.equal(summary(raw({ content_text: null })).label, "분석 불가 · 본문 없음");
  assert.equal(summary(raw({ source: "calendar", format: "calendar_event" })).label, "일정 자료");
  assert.equal(summary(raw({ source: "upload", format: "pdf", content_text: null, processing_status: "extracting", metadata: { upload: { extraction: { status: "running" } } } })).canPoll, true);
});

test("only actual queued jobs, live leases and eligible processing states poll; terminal states stop", () => {
  assert.equal(summary(raw()).canPoll, false);
  assert.equal(summary(raw(), job).canPoll, true);
  assert.equal(summary(raw(), { ...job, schedulerAvailable: false }).canPoll, false);
  assert.equal(summary(raw(), { ...job, state: "running", leaseUntil: "2000-01-01T00:00:00Z" }).canPoll, false);
  assert.equal(summary(raw(), { ...job, state: "running", schedulerAvailable: false, leaseUntil: "2100-01-01T00:00:00Z" }).canPoll, true);
  assert.equal(summary(raw({ processing_status: "analyzing" })).canPoll, true);
  assert.equal(summary(raw({ processing_status: "analyzing" }), { ...job, state: "running", leaseUntil: "2000-01-01T00:00:00Z" }).canPoll, false);
  assert.equal(summary(raw({ processing_status: "indexing" })).canPoll, true);
  for (const status of ["failed", "completed"]) assert.equal(summary(raw({ processing_status: status }), job).canPoll, false);
  assert.equal(summary(raw({ processing_status: "failed" }), { ...job, state: "retry" }).canPoll, true);
  assert.equal(summary(raw({ processing_status: "failed" }), { ...job, state: "retry", schedulerAvailable: false }).canPoll, false);
});

test("safe processing error messages never echo arbitrary database or provider content", () => {
  assert.match(processingErrorMessage("GEMINI_HTTP_429"), /한도/);
  assert.match(processingErrorMessage("ANALYSIS_WORKER_PAUSED"), /중지/);
  assert.match(processingErrorMessage("ANALYSIS_VALIDATION_FAILED"), /원문/);
  const value = summary(raw({ processing_status: "failed", processing_error: "provider-secret-private-source" }));
  assert.equal(value.errorCode, null);
  assert.doesNotMatch(JSON.stringify(value), /provider-secret-private-source|Synthetic body/);
  assert.equal(value.canPoll, false);
});

test("AnalyzeControl shows safe worker errors and keeps a 202 response explicitly pending", async () => {
  const code = ts.transpileModule(readFileSync(new URL("../src/components/items/detail-tools.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const status of [503, 202]) {
    const states = [], exports = {}; let hookIndex = 0, requests = 0;
    const react = { ...React, useState: initial => { const index = hookIndex++; states[index] = initial; return [initial, value => { states[index] = value; }]; } };
    runInNewContext(code, { exports, fetch: async () => { requests++; return Response.json(status === 503 ? { error: { code: "ANALYSIS_WORKER_PAUSED", message: "private-provider-message" } } : { queued: true }, { status }); }, require(name) {
      if (name === "react") return react;
      if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
      if (name === "next/link") return () => null;
      if (name === "@/lib/items/processing") return { processingErrorMessage };
      return require(name);
    } });
    const element = exports.AnalyzeControl({ itemId: id, status: "queued" });
    element.props.children.find(child => child?.type === "button").props.onClick();
    for (let index = 0; index < 12; index++) await Promise.resolve();
    assert.equal(requests, 1); assert.equal(states[0], false);
    assert.match(states[1], status === 503 ? /일정이 중지/ : /백그라운드 분석을 요청/);
    assert.doesNotMatch(states[1], /private-provider-message|분석 결과가 저장/);
    assert.equal(states[2], status === 503);
  }
});

test("read-only status API scopes owner, limits IDs and excludes text, metadata and unsafe errors", async () => {
  const calls = [];
  const client = createClient("https://synthetic.invalid", "fixture", { auth: { persistSession: false }, global: { fetch: async (url, request) => {
    const target = new URL(url); calls.push({ target, request });
    assert.equal(request.method, "GET");
    return Response.json([raw({ source: "manual", format: "text", processing_status: "failed", processing_error: "provider-secret", metadata: { secret: "private-token" } })]);
  } } });
  class AuthenticationRequiredError extends Error {}
  const auth = { requireUser: async () => ({ id: "owner" }), AuthenticationRequiredError };
  const load = uiLoader({ "@/lib/supabase/auth": auth, "@/lib/supabase/server": { createClient: async () => client } });
  const route = load("src/app/api/v1/items/processing/route.ts");
  const response = await route.GET(new Request(`https://synthetic.invalid/api/v1/items/processing?ids=${id},${foreign}`));
  assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  const body = await response.json();
  assert.equal(body.items.length, 1); assert.equal(body.items[0].id, id);
  assert.equal(calls[0].target.searchParams.get("user_id"), "eq.owner");
  assert.equal(calls[0].target.searchParams.get("limit"), "100");
  assert.doesNotMatch(JSON.stringify(body), /Synthetic body|private-token|provider-secret|content_text|metadata/);
  const { parseProcessingIds } = load("src/lib/items/processing-queries.ts");
  for (const params of ["", "ids=invalid", `ids=${id}&ids=${foreign}`, `ids=${id}&user_id=foreign`, `ids=${id},${id}`, `ids=${Array(101).fill(id).join(",")}`]) assert.throws(() => parseProcessingIds(new URLSearchParams(params)));
  let dbCalls = 0;
  const anonymous = uiLoader({ "@/lib/supabase/auth": { AuthenticationRequiredError, requireUser: async () => { throw new AuthenticationRequiredError(); } }, "@/lib/supabase/server": { createClient: async () => { dbCalls++; } } });
  assert.equal((await anonymous("src/app/api/v1/items/processing/route.ts").GET(new Request("https://synthetic.invalid/api/v1/items/processing?ids=invalid"))).status, 401);
  assert.equal(dbCalls, 0);
});

test("job projection ignores foreign rows and safely handles a missing status migration", async () => {
  const load = uiLoader({ "@/lib/supabase/auth": {}, "@/lib/supabase/server": {}, "@/lib/items/free-analysis-scope": { freeAnalysisScope: () => ({ users: ["owner"], items: [id] }) } });
  const { readAnalysisJobs, projectProcessing } = load("src/lib/items/processing-queries.ts");
  const unavailable = { rpc: async () => ({ data: null, error: { code: "PGRST202" } }) };
  assert.equal((await projectProcessing(unavailable, [raw()])).get(id).canPoll, false);
  const jobs = await readAnalysisJobs({ rpc: async (name, args) => { assert.equal(name, "gmail_analysis_job_status"); assert.deepEqual(plain(args), { p_item_ids: [id] }); return { data: [job, { ...job, itemId: foreign, secret: "hidden" }], error: null }; } }, [id], "owner");
  assert.equal(jobs.size, 1); assert.equal(jobs.get(id).schedulerAvailable, true);
  assert.doesNotMatch(JSON.stringify([...jobs]), /hidden/);
});

test("Detail hides analysis for missing text, preserves original/evidence, and explains the state", async () => {
  const item = { id, title: "Empty source", source: "gmail", format: "email", processingStatus: "queued", createdAt: time, updatedAt: time, contentText: null, sourceCreatedAt: null };
  const processing = summary(raw({ content_text: null }));
  const classification = ui("src/lib/items/presentation.ts").effectiveClassification(null);
  const load = uiLoader({
    "@/lib/supabase/auth": { requirePageUser: async () => ({ id: "owner" }) },
    "@/lib/items/queries": { getItemDetail: async () => ({ item, processing, classification, aiAnalysis: null, actions: [], evidence: [], eventObservations: [], calendar: null, upload: null, gmail: null, original: { previewType: "google", url: "https://mail.google.com/" } }) },
    "@/components/shell/app-shell": { AppShell: ({ children }) => React.createElement("main", {}, children) },
    "@/components/items/processing-refresh": { ProcessingRefresh: () => null },
  });
  const Page = load("src/app/items/[itemId]/page.tsx").default;
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ itemId: id }), searchParams: Promise.resolve({ returnTo: "/library?source=gmail&processingStatus=completed" }) }));
  assert.match(html, /href="\/library\?source=gmail&amp;processingStatus=completed"/);
  const fallback = renderToStaticMarkup(await Page({ params: Promise.resolve({ itemId: id }), searchParams: Promise.resolve({ returnTo: "https://external.invalid" }) }));
  assert.match(fallback, /href="\/library"/);
  assert.match(html, /분석 불가 · 본문 없음/); assert.match(html, /저장된 본문이 없어/);
  assert.match(html, /https:\/\/mail.google.com\//); assert.match(html, /최근 변경/);
  assert.doesNotMatch(html, /AI 분석하기|AI 분석 관리/);
});

function pollingHarness() {
  let now = 0, nextId = 0, visible = true, listener = null;
  const timers = new Map();
  class Clock extends Date { static now() { return now; } }
  const globals = { Date: Clock, AbortController, setTimeout: (fn, delay) => { const key = ++nextId; timers.set(key, { fn, at: now + delay }); return key; }, clearTimeout: key => timers.delete(key) };
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/items/processing-poller.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; runInNewContext(code, { exports, ...globals, require });
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  return { ...exports, timers, flush,
    options: { initial: snapshot("queued"), deadline: 300000, isVisible: () => visible, subscribeVisibility: callback => { listener = callback; return () => { listener = null; }; } },
    async advance(ms) { const until = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); } now = until; await flush(); },
    setVisible(value) { visible = value; listener?.(); },
  };
}

test("5-second status polling follows real transitions and stops after completion", async () => {
  const h = pollingHarness(), states = ["analyzing", "indexing", "completed"], changes = [], stops = []; let reads = 0;
  h.startProcessingPolling({ ...h.options, read: async () => { reads++; return snapshot(states.shift()); }, onChange: () => changes.push("refresh"), onStop: value => stops.push(value) });
  await h.advance(4999); assert.equal(reads, 0);
  await h.advance(10001); assert.equal(reads, 3); assert.equal(changes.length, 3); assert.deepEqual(stops, ["settled"]);
  await h.advance(300000); assert.equal(reads, 3); assert.equal(h.timers.size, 0);
});

test("hidden tabs pause, active requests are aborted, reads never overlap and disposal cancels work", async () => {
  const h = pollingHarness(); let reads = 0, active = 0, maximum = 0, finish;
  const dispose = h.startProcessingPolling({ ...h.options, read: signal => {
    reads++; active++; maximum = Math.max(maximum, active);
    return new Promise((resolve, reject) => { finish = () => { active--; resolve(snapshot("analyzing")); }; signal.addEventListener("abort", () => { active--; reject(new Error("aborted")); }, { once: true }); });
  }, onChange() {}, onStop() {} });
  await h.advance(5000); await h.advance(4000); assert.equal(reads, 1);
  h.setVisible(false); await h.flush(); await h.advance(30000); assert.equal(reads, 1); assert.equal(active, 0);
  h.setVisible(true); await h.advance(5000); assert.equal(reads, 2); finish(); await h.flush();
  await h.advance(5000); assert.equal(reads, 3); assert.equal(maximum, 1);
  dispose(); await h.flush(); await h.advance(300000); assert.equal(reads, 3); assert.equal(active, 0); assert.equal(h.timers.size, 0);
});

test("failed status, network errors, request timeout and the five-minute bound stop further reads", async () => {
  for (const mode of ["failed", "error", "timeout", "limit"]) {
    const h = pollingHarness(), stops = []; let reads = 0;
    h.startProcessingPolling({ ...h.options, read: async signal => { reads++; if (mode === "error") throw new Error("private"); if (mode === "timeout") return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))); return mode === "failed" ? snapshot("failed") : snapshot("queued"); }, onChange() {}, onStop: reason => stops.push(reason) });
    await h.advance(300000); const finishedReads = reads; await h.advance(300000);
    assert.equal(reads, finishedReads); assert.equal(h.timers.size, 0);
    assert.deepEqual(stops, [mode === "failed" ? "settled" : mode === "limit" ? "limit" : "error"]);
    assert.ok(reads <= 59); if (mode !== "limit") assert.equal(reads, 1);
  }
});

test("ProcessingRefresh rerenders preserve the budget when active IDs shrink; new work and explicit retry renew it", () => {
  let now = 0, hookIndex = 0, pending = [];
  const hooks = [], starts = [];
  const router = { refresh() {} };
  const react = { ...React,
    useState(initial) { const index = hookIndex++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
    useRef(initial) { const index = hookIndex++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect(callback, deps) { const index = hookIndex++, previous = hooks[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { pending.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; }); } },
  };
  class Clock extends Date { static now() { return now; } }
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../src/components/items/processing-refresh.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, Date: Clock, URLSearchParams, require(name) {
    if (name === "react") return react;
    if (name === "next/navigation") return { useRouter: () => router };
    if (name === "@/lib/items/processing-poller") return { PROCESSING_POLL_LIMIT: 300000, processingSnapshotKey: value => JSON.stringify(value), startProcessingPolling: options => { starts.push(options); return () => {}; } };
    return require(name);
  } });
  const render = items => { hookIndex = 0; const element = exports.ProcessingRefresh({ items }); const tasks = pending; pending = []; tasks.forEach(run => run()); return element; };
  const first = snapshot("queued")[0], second = { ...first, id: foreign };
  render([first, second]); assert.equal(starts.at(-1).deadline, 300000);
  now = 100000; render([first]); assert.equal(starts.at(-1).deadline, 300000);
  now = 200000; render(snapshot("analyzing")); assert.equal(starts.at(-1).deadline, 300000);
  render([]); now = 250000; render([first]); assert.equal(starts.at(-1).deadline, 550000);
  now = 300000; render([first, second]); assert.equal(starts.at(-1).deadline, 600000);
  starts.at(-1).onStop("limit");
  const element = render([first, second]);
  const button = element.props.children.find(child => child?.type === "button");
  now = 500000; button.props.onClick(); render([first, second]); assert.equal(starts.at(-1).deadline, 800000);
});
