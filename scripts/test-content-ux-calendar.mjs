import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAnalysisModule as load } from "./analysis-loader.mjs";
import { uiLoader } from "./content-ui-loader.mjs";
import { cases, reference } from "./content-calendar-fixtures.mjs";

const validator = load("src/lib/gemini/validation.ts");
const dates = load("src/lib/gemini/date-context.ts");
const schedule = load("src/components/actions/schedule-model.ts");
const context = dates.analysisDateContext(reference);
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const plain = value => JSON.parse(JSON.stringify(value));

for (const fixture of cases) test(`${fixture.name}: evidence-grounded date interpretation preserves Action/Event separation`, () => {
  const current = dates.analysisDateContext({ ...reference, source: fixture.source, source_created_at: reference.created_at });
  const output = validator.validateAnalysis(fixture.output, fixture.text, current);
  assert.equal(output.actions.length, fixture.actions);
  assert.equal(output.eventObservations.length, fixture.events);
  const detail = { item: { id: "manual-fixture", title: fixture.text, source: fixture.source }, calendar: null, eventObservations: output.eventObservations };
  const events = schedule.eventsFromDetail(detail);
  assert.equal(events.length, fixture.events);
  if (events.length) assert.equal(schedule.eventOnDay(events[0], "2026-10-24"), true);
  if (fixture.actions) assert.equal(output.actions[0].deadlineObservation.date, fixture.name === "manual-mixed" ? "2026-10-20" : "2026-10-24");
  // No schema field currently establishes confirmed promotional status. Never hide by topic/tag.
  if (fixture.name.includes("promotion")) assert.equal(output.classification.promotional, undefined);
});

test("source-specific reference date is fixed, KST-based, and never replaced by today's date", () => {
  assert.equal(context.referenceDate, "2026-10-12");
  assert.equal(dates.analysisDateContext({ source: "manual", created_at: "2026-12-31T15:01:00Z" }).referenceDate, "2027-01-01");
  const mail = dates.analysisDateContext({ source: "gmail", created_at: "2026-10-12T00:00:00Z", source_created_at: "2025-10-12T00:00:00Z" });
  assert.equal(mail, undefined);
  assert.equal(validator.validateAnalysis(cases[0].output, cases[0].text, mail).eventObservations[0].date, null);
  assert.equal(dates.analysisDateContext({ source: "drive", source_created_at: reference.created_at }), undefined);
  assert.equal(dates.analysisDateContext({ source: "upload", created_at: reference.created_at }), undefined);
  assert.equal(dates.analysisDateContext({ source: "gmail", created_at: reference.created_at }), undefined);
  assert.equal(dates.analysisDateContext({ source: "calendar", created_at: reference.created_at }), undefined);
});

test("year boundaries, past/future context, invalid dates, and ambiguous evidence are handled conservatively", () => {
  const resolve = (raw, text, referenceDate, source = "manual") => dates.resolveYearlessDate(raw, text, { ...context, source, referenceDate });
  assert.equal(resolve("1월 2일", "1월 2일 코딩테스트", "2026-12-31"), "2027-01-02");
  assert.equal(resolve("12월 31일", "12월 31일에 진행했던 코딩테스트", "2027-01-02"), "2026-12-31");
  assert.equal(resolve("10월 24일", "10월 24일 예정", "2026-10-25"), "2027-10-24");
  for (const [raw, text] of [["2월 30일", "2월 30일 예정"], ["10월 24일", "아마 10월 24일"], ["10월 24일", "매년 10월 24일"], ["10월 24일", "예전 10월 24일"], ["10월 24일", "10월 24일 완료, 다시 제출 예정"], ["10월 24일과 10월 25일", "10월 24일과 10월 25일"]]) assert.equal(resolve(raw, text, "2026-10-12"), null);
  assert.equal(resolve("10월 24일", "10월 24일 코딩테스트", "2026-10-25"), null);
  assert.equal(resolve("10월 24일", "10월 24일 코딩테스트", "2026-10-12", "upload"), null);
  assert.equal(resolve("10월 24일", "10월 24일 예정", "2026-10-12", "drive"), null);
  assert.equal(resolve("10월 24일", "합격하면 10월 24일 참석 예정", "2026-10-12"), null);
  assert.equal(resolve("10월 24일", "10월 24일 또는 25일", "2026-10-12"), null);
  assert.equal(resolve("10월 24일", "10월 24일 예정", "2026-02-30"), null);
});

test("year interpretation cannot authorize a fabricated deadline or change exact evidence", () => {
  const wrong = structuredClone(cases[1].output);
  wrong.actions[0].deadlineObservation.evidence.text = "10월 24일 코딩테스트";
  wrong.actions[0].evidence = [wrong.actions[0].deadlineObservation.evidence];
  assert.throws(() => validator.validateAnalysis(wrong, "10월 24일 코딩테스트", context), validator.AnalysisValidationError);
  const candidate = structuredClone(cases[0].output);
  candidate.eventObservations[0].evidence.text = "2026년 10월 24일 코딩테스트";
  assert.throws(() => validator.validateAnalysis(candidate, cases[0].text, context), validator.AnalysisValidationError);
  const resolved = validator.validateAnalysis(cases[0].output, cases[0].text, context);
  assert.equal(resolved.eventObservations[0].evidence.text, cases[0].text);
  assert.equal(cases[0].output.eventObservations[0].date, null);
  assert.equal(validator.validateAnalysis(resolved, cases[0].text, context).eventObservations[0].date, "2026-10-24");
});

test("unresolved dates have a visible review list and never get a calendar cell", () => {
  const item = { id: "unclear", title: "날짜가 모호한 메모", source: "manual" };
  const detail = { item, calendar: null, eventObservations: validator.validateAnalysis(cases[0].output, cases[0].text).eventObservations };
  assert.equal(schedule.eventsFromDetail(detail).length, 0);
  const pending = schedule.unresolvedEventsFromDetail(detail);
  assert.equal(pending.length, 1);
  const { UnresolvedEvents } = uiLoader()("src/components/actions/unresolved-events.tsx");
  const html = render(UnresolvedEvents, { events: pending });
  assert.match(html, /날짜 확인이 필요한 AI 일정/);
  assert.match(html, /10월 24일 코딩테스트/);
  assert.match(html, /href="\/items\/unclear"/);
});

test("Library default UI has search, source tabs, collapsed format/date control and no taxonomy controls", () => {
  const ui = uiLoader({ "@/components/actions/use-workspace-data": { useItemDetails: () => ({ details: {}, busy: false, error: "", reload() {} }) } });
  const { LibraryToolbar } = ui("src/components/library/library-toolbar.tsx");
  const { LibraryList } = ui("src/components/library/library-list.tsx");
  const { parseItemQuery } = ui("src/lib/items/filters.ts");
  const toolbar = React.createElement(LibraryToolbar, { query: parseItemQuery(new URLSearchParams()) });
  const html = render(LibraryList, { items: [], toolbar });
  assert.ok(html.indexOf("자료함 검색어") < html.indexOf("자료 출처 필터"));
  assert.match(html, /action="\/search"/);
  assert.match(html, /직접입력/);
  assert.match(html, /<details>/);
  for (const name of ["topic", "documentType", "processingStatus"]) assert.doesNotMatch(html, new RegExp(`name="${name}"`));
  const filtered = render(LibraryToolbar, { query: parseItemQuery(new URLSearchParams("source=calendar&topic=공지&documentType=notice&processingStatus=failed&format=text&limit=10")) });
  assert.match(filtered, /페이지 주소의 추가 조건/);
  assert.match(filtered, /name="topic"/);
  assert.match(filtered, /<details open="">/);
  assert.match(filtered, /href="\/library\?source=calendar&amp;limit=10"/);
});

test("monthly calendar renders Manual AI events, Google events and Action deadlines distinctly", () => {
  const ui = uiLoader();
  const { FullMonthCalendar } = ui("src/components/actions/full-month-calendar.tsx");
  const output = validator.validateAnalysis(cases[0].output, cases[0].text, context);
  const manual = schedule.eventsFromDetail({ item: { id: "manual", title: "코딩테스트", source: "manual" }, calendar: null, eventObservations: output.eventObservations });
  const google = schedule.eventsFromDetail({ item: { id: "google", title: "팀 회의", source: "calendar" }, calendar: { status: "confirmed", start: { date: "2026-10-24" }, end: { date: "2026-10-25" } }, eventObservations: [] });
  const action = { actionId: "deadline", title: "과제 제출", status: "open", deadlineStatus: "confirmed", deadlineDate: "2026-10-24", deadlineAt: null, sources: [] };
  const html = render(FullMonthCalendar, { month: "2026-10", onMonth() {}, today: "2026-10-12", selected: "2026-10-24", onSelect() {}, busy: false, actions: [action], events: [...manual, ...google] });
  for (const label of ["AI 일정 · 코딩테스트", "Google 일정 · 팀 회의", "마감 · 과제 제출"]) assert.ok(html.includes(label));
  const cell = html.slice(html.indexOf('data-calendar-date="2026-10-24"'), html.indexOf('data-calendar-date="2026-10-25"'));
  assert.match(cell, /코딩테스트/);
  assert.match(cell, /팀 회의/);
  assert.match(cell, /과제 제출/);
});

test("Gemini transport receives source/date context and server resolves yearless Event before persistence", async () => {
  const gemini = load("src/lib/gemini/client.ts", { "@/lib/gemini/validation": validator }, {
    process: { env: { GEMINI_API_KEY: "fixture", GEMINI_MODEL: "gemini-fixture" } },
    fetch: async (_url, request) => {
      const payload = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text);
      assert.deepEqual(payload.dateContext, plain(context));
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({...cases[0].output,schemaVersion:'0.3',noiseAssessment:{verdict:'normal',confidence:null,evidence:[],reasons:['non_promotional'],protectionSignals:[]}}) }] } }] });
    },
  });
  const output = await gemini.analyzeGmailText(cases[0].text, [], context, "0.3");
  const analysis = load("src/lib/items/analysis.ts", { "@/lib/gemini/validation": validator, "@/lib/gemini/client": gemini, "@/lib/items/filters": {}, "@/lib/supabase/auth": {}, "@/lib/supabase/server": {}, "@/lib/supabase/admin": {} });
  let calls = 0;
  await analysis.persistValidatedAnalysis({ rpc: async (name, args) => {
    calls++;
    assert.equal(name, "persist_eligible_item_analysis");
    assert.equal(args.p_analysis.eventObservations[0].date, "2026-10-24");
    assert.equal(args.p_analysis.actions.length, 0);
    return { data: { action_count: 0, created_count: 0, reused_count: 0, cached: false } };
  } }, { userId: "fixture", itemId: "fixture", contentText: cases[0].text, contentHash: null, result: output, model: "gemini-fixture", fingerprint: "a".repeat(64), eligibleSource: true, dateContext: context });
  assert.equal(calls, 1);
});

test("Manual POST creates an eligible Unified ITEM with its own reference timestamp", async () => {
  let inserted;
  const admin = { from(table) {
    assert.equal(table, "items");
    const q = { select() { return q; }, eq(key, value) { if (key === "user_id") assert.equal(value, "fixture-owner"); return q; }, gte() { return q; }, order() { return q; }, limit() { return q; },
      maybeSingle: async () => ({ data: null }), insert(row) { inserted = row; return q; }, single: async () => ({ data: inserted }) };
    return q;
  } };
  const auth = { requireUser: async () => ({ id: "fixture-owner" }), AuthenticationRequiredError: class extends Error {} };
  const manual = load("src/lib/items/manual.ts", { "@/lib/supabase/auth": auth, "@/lib/supabase/admin": { createAdminClient: () => admin } });
  const route = load("src/app/api/v1/items/manual/route.ts", { "@/lib/supabase/auth": auth, "@/lib/items/manual": manual });
  const response = await route.POST(new Request("http://localhost/api/v1/items/manual", { method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ content: cases[0].text }) }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).analysisStatus, "queued");
  assert.equal(inserted.source, "manual");
  assert.equal(inserted.format, "text");
  assert.equal(inserted.content_text, cases[0].text);
  assert.ok(inserted.metadata.manual.createdAt);
  assert.equal(load("src/lib/items/analysis-policy.ts").analysisEligible(inserted), true);
});

test("Home, Search, Item Detail, Actions, Manual input and Upload controls retain their view contracts (isolated SSR smoke)", async () => {
  const now = Date.parse("2026-10-12T01:00:00Z");
  const hooks = { useActions: () => ({ rows: [], busy: false, error: "", reload() {} }), useScheduleItems: () => ({ items: [], details: {}, busy: false, error: "", hasMore: false, reload() {} }) };
  const ui = uiLoader({
    "./use-workspace-data": hooks,
    "@/components/actions/use-workspace-data": hooks,
    "@/components/shell/app-shell": { AppShell: ({ children }) => React.createElement("main", {}, children) },
    "@/lib/items/queries": { listItems: async () => ({ items: [], nextCursor: null }) },
    "@/lib/supabase/auth": { getCurrentUser: async () => null },
    "@/lib/google/connections": {},
    "@/components/workspace/request-clock": { getWorkspaceClock: async () => now },
    "@/lib/uploads/browser/flow": { runUpload() { assert.fail("SSR must not upload/OCR"); } },
  });
  const home = await ui("src/components/home/today-view.tsx").TodayView();
  const homeHtml = renderToStaticMarkup(home);
  assert.match(homeHtml, /오늘 캘린더/);
  assert.match(homeHtml, /다가오는 일정/);
  assert.doesNotMatch(homeHtml, /최근 추가된 자료/);
  assert.match(render(ui("src/components/search/search-workspace.tsx").SearchWorkspace, { initialQuery: "코딩테스트", initialNow: now }), /통합 검색어/);
  assert.match(render(ui("src/components/actions/schedule-workspace.tsx").ScheduleWorkspace, { today: "2026-10-12", now }), /할 일 · 일정/);
  const value = load("src/lib/items/presentation.ts").effectiveClassification({ ai_primary_topic: "AI 주제", user_primary_topic: "사용자 주제", ai_document_type: "notice", user_document_type: null, ai_tags: [], user_tags: [] });
  const detail = render(ui("src/components/items/item-summary.tsx").ClassificationSummary, { value, detailed: true });
  assert.match(detail, /사용자 주제/);
  assert.match(detail, /직접 수정/);
  assert.match(render(ui("src/components/items/manual-text-controls.tsx").ManualTextControls, {}), /저장하고 AI 분석/);
  assert.match(render(ui("src/components/uploads/upload-controls.tsx").UploadControls, { userId: "synthetic" }), /PDF · 이미지/);
});

test("explicit reanalysis upgrades a cached yearless Manual result through its claim/RPC without calling Gemini", async () => {
  const model = "gemini-fixture";
  const policy = load("src/lib/items/analysis-policy.ts");
  const old = validator.validateAnalysis(cases[0].output, cases[0].text);
  const item = { id: "11111111-1111-4111-8111-111111111111", ...reference, format: "text", content_text: cases[0].text, content_hash: null, processing_status: "indexing", updated_at: "old", metadata: { aiAnalysis: { schemaVersion: "0.2", model, inputFingerprint: policy.analysisFingerprint(cases[0].text, model, "0.2"), result: old } } };
  const read = { select() { return read; }, eq() { return read; }, maybeSingle: async () => ({ data: item }), limit: async () => ({ data: [] }) };
  let claims = 0, writes = 0;
  const admin = { from() {
    const q = { update() { claims++; return q; }, eq() { return q; }, select() { return q; }, maybeSingle: async () => ({ data: { updated_at: "claimed" } }) };
    return q;
  }, rpc: async (name, args) => {
    writes++;
    assert.equal(name, "persist_eligible_item_analysis");
    assert.equal(args.p_analysis.eventObservations[0].date, "2026-10-24");
    return { data: { action_count: 0, created_count: 0, reused_count: 0, cached: false } };
  } };
  const analysis = load("src/lib/items/analysis.ts", { "@/lib/gemini/validation": validator,
    "@/lib/gemini/client": { getGeminiConfig: () => ({ model }), analyzeGmailText() { assert.fail("cache interpretation must not call provider"); }, GeminiAnalysisError: class extends Error {} },
    "@/lib/items/filters": { isItemId: () => true }, "@/lib/supabase/auth": { requireUser: async () => ({ id: "owner" }) }, "@/lib/supabase/server": { createClient: async () => ({ from: () => read }) }, "@/lib/supabase/admin": { createAdminClient: () => admin } });
  await analysis.analyzeOwnedItem(item.id);
  assert.equal(claims, 1);
  assert.equal(writes, 1);
  assert.equal(old.eventObservations[0].date, null);
});

test("Home agenda shows only today's open actions and preserves evidenced event times", () => {
  const ui = uiLoader({});
  const action = { kind: "action", actionId: "same-action", title: "오늘 제출", type: "required", status: "open", deadlineStatus: "confirmed", deadlineDate: "2026-10-13", deadlineAt: "2026-10-13T15:30:00+09:00", sources: [], requirements: [], conditions: [] };
  const event = { id: "calendar:event", itemId: "event", title: "내일 회의", source: "calendar", kind: "calendar", date: "2026-10-14", lastDate: "2026-10-14", time: "2026-10-14T10:00:00+09:00", evidence: "원문", tentative: false };
  const props = { today: "2026-10-13", busy: false, error: "", scheduleError: "", eventEnds: { [event.id]: "2026-10-14T12:00:00+09:00" }, events: [event], actions: [action, { ...action, actionId: "undated", title: "날짜 미정 작업", deadlineDate: null, deadlineAt: null }, { ...action, actionId: "done", title: "완료 작업", status: "completed" }, { ...action, actionId: "tomorrow", title: "내일 작업", deadlineDate: "2026-10-14", deadlineAt: null }] };
  const html = render(ui("src/components/home/today-todo-list.tsx").TodayTodoList, props);
  assert.match(html, /오늘 제출/); assert.match(html, /15:30/); assert.match(html, /10:00 - 12:00/);
  assert.doesNotMatch(html, /날짜 미정 작업|완료 작업|내일 작업|checkbox|진행중|할 일 추가/);
  const calendar = render(ui("src/components/home/today-calendar.tsx").TodayCalendar, { today: props.today, actions: [action], events: [event], busy: false });
  assert.match(calendar, /오늘 제출/); assert.match(calendar, /내일 회의/);
  assert.doesNotMatch(calendar, /15:30|10:00|12:00/);
});

test("Home distinguishes unknown event time and missing end time without inventing a duration", () => {
  const ui = uiLoader({});
  const event = { id: "one", itemId: "one", title: "시작만 확인", source: "calendar", kind: "calendar", date: "2026-10-14", lastDate: "2026-10-14", time: "2026-10-14T09:00:00+09:00", evidence: "원문", tentative: false };
  const html = render(ui("src/components/home/today-todo-list.tsx").TodayTodoList, { today: "2026-10-13", actions: [], events: [event, { ...event, id: "two", time: null }], eventEnds: {}, busy: false, error: "", scheduleError: "" });
  assert.match(html, /09:00/); assert.match(html, /종일/); assert.doesNotMatch(html, /09:00 -/);
});

test("Quick Todo persists a single direct Action and returns that same ID to both Home lists", async () => {
  let inserts = 0;
  const row = { id: "direct-action", title: "코딩테스트 준비", action_type: "required", status: "open", deadline_status: "confirmed", deadline_date: "2026-10-13", deadline_at: "2026-10-13T14:00:00+09:00", requirements: [], conditions: [] };
  const admin = { from(table) {
    assert.equal(table, "actions");
    return { insert(value) { inserts++; assert.equal(value.user_id, "fixture-owner"); assert.equal(value.deadline_at, row.deadline_at); return { select() { return { single: async () => ({ data: row, error: null }) }; } }; } };
  } };
  const { createManualAction } = uiLoader({ "@/lib/items/writes": { ItemWriteError: class extends Error {} }, "./writes": { ItemWriteError: class extends Error {} }, "@/lib/supabase/auth": { requireUser: async () => ({ id: "fixture-owner" }) }, "@/lib/supabase/admin": { createAdminClient: () => admin } })("src/lib/items/manual-action.ts");
  const { action } = await createManualAction({ title: row.title, date: row.deadline_date, time: "14:00" });
  assert.equal(inserts, 1); assert.equal(action.actionId, row.id); assert.equal(action.sources.length, 0);
  const ui = uiLoader({});
  const props = { today: row.deadline_date, actions: [action], events: [], busy: false };
  assert.match(render(ui("src/components/home/today-calendar.tsx").TodayCalendar, props), /코딩테스트 준비/);
  assert.match(render(ui("src/components/home/today-todo-list.tsx").TodayTodoList, { ...props, eventEnds: {}, error: "", scheduleError: "" }), /코딩테스트 준비/);
});

test('Home today Actions remain visible while source Events are still loading', () => {
  const ui = uiLoader();
  const action = { kind: 'action', actionId: 'manual-e2e', title: 'E2E visible manual todo', type: 'required', status: 'open', deadlineStatus: 'confirmed', deadlineDate: '2026-10-13', deadlineAt: '2026-10-13T14:00:00+09:00', sources: [] };
  const html = render(ui('src/components/home/today-todo-list.tsx').TodayTodoList, { today: '2026-10-13', actions: [action], events: [], eventEnds: {}, busy: false, scheduleBusy: true, error: '', scheduleError: '' });
  assert.match(html, /E2E visible manual todo/);
  assert.match(html, /14:00/);
  assert.doesNotMatch(html, /할 일을 불러오는 중/);
  assert.match(html, /일정을 불러오는 중/);
});
