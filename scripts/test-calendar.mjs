import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseFragment } from "parse5";
import { load } from "./calendar-loader.mjs";
const contract = load("src/lib/google/calendar-contract.ts");
const { htmlToText } = load("src/lib/google/gmail-message.ts", { parse5: { parseFragment } });
const scope = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
const old = "2026-10-01T01:00:00Z", next = "2026-10-02T01:00:00Z";
const raw = (changes = {}) => ({ id: "event_1", etag: '"v1"', eventType: "default", status: "confirmed",
  created: old, updated: old, summary: "Synthetic", description: "<p>A &amp; B</p><script>hidden</script>", location: "Room",
  htmlLink: "https://www.google.com/calendar/event?eid=synthetic",
  start: { dateTime: "2026-10-05T09:00:00+09:00", timeZone: "Asia/Seoul" },
  end: { dateTime: "2026-10-05T10:00:00+09:00", timeZone: "Asia/Seoul" }, ...changes });
const parse = v => contract.parseEvent(v, "Asia/Seoul", htmlToText);
const plain = v => JSON.parse(JSON.stringify(v));
test("Calendar validation preserves dates, timezone and exclusive end without inferring source times", () => {
  const e = parse(raw({ created: undefined, updated: undefined }));
  assert.equal(e.created, null); assert.equal(e.updated, null);
  assert.equal(e.start.dateTime, "2026-10-05T09:00:00+09:00"); assert.equal(e.eventTimezone, "Asia/Seoul");
  assert.equal(e.calendarTimezone, "Asia/Seoul"); assert.equal(e.allDay, false);
  const allDay = parse(raw({ start: { date: "2026-10-05" }, end: { date: "2026-10-07" } }));
  assert.equal(allDay.allDay, true); assert.equal(allDay.start.date, "2026-10-05");
  assert.ok(!JSON.stringify(allDay.start).includes("T00")); assert.equal(allDay.end.date, "2026-10-07");
  for (const changes of [{ start: { date: "2026-02-30" } }, { end: { date: "2026-10-01" } },
    { start: { dateTime: "2026-10-01T09:00:00" } }, { start: { date: "2026-10-05", dateTime: old } },
    { start: { dateTime: old, timeZone: "invalid" } }, { status: "invalid" }, { updated: "not-a-date" }])
    assert.throws(() => parse(raw(changes)), /INVALID_EVENT/);
});
test("canonical text uses fixed order, safe description, hash and no excluded personal data", () => {
  const e = parse(raw({ attendees: [{ email: "excluded@example.invalid" }], organizer: { email: "excluded@example.invalid" },
    conferenceData: { password: "do-not-store" }, extendedProperties: { private: { secret: "do-not-store" } } }));
  const content = contract.canonicalEvent(e);
  assert.equal(e.description, "A & B"); assert.ok(!content.text.includes("hidden"));
  assert.ok(content.text.startsWith("Synthetic\n\nA & B\n\nRoom\n\nEvent start:"));
  assert.equal(content.hash, createHash("sha256").update(content.text).digest("hex"));
  assert.ok(!JSON.stringify(e).includes("excluded@example")); assert.ok(!JSON.stringify(e).includes("do-not-store"));
  assert.equal(parse(raw({ htmlLink: "https://calendar.google.com.evil.invalid/event" })).htmlLink, null);
  assert.equal(parse(raw({ htmlLink: "https://user:password@calendar.google.com/event" })).htmlLink, null);
  assert.throws(() => contract.canonicalEvent(parse(raw({ summary: "x".repeat(100000) }))), /EVENT_LIMIT/);
});
test("recurring instances use immutable eventId and originalStartTime; masters and non-default types excluded", () => {
  const e = parse(raw({ recurringEventId: "master_1", originalStartTime: raw().start }));
  const moved = parse(raw({ recurringEventId: "master_1", originalStartTime: raw().start,
    start: { dateTime: "2026-10-06T09:00:00+09:00" }, end: { dateTime: "2026-10-06T10:00:00+09:00" } }));
  assert.equal(e.eventId, moved.eventId); assert.deepEqual(plain(e.originalStartTime), plain(moved.originalStartTime));
  assert.equal(parse(raw({ recurrence: ["RRULE:FREQ=DAILY"] })), null);
  for (const eventType of ["birthday", "focusTime", "outOfOffice", "workingLocation", "fromGmail", "unknown"])
    assert.equal(parse(raw({ eventType })), null);
  assert.ok(parse(raw({ summary: "Birthday" }))); assert.ok(parse(raw({ summary: "Holiday" })));
  assert.throws(() => parse(raw({ recurringEventId: "master_1" })), /INVALID_EVENT/);
});
test("minimal cancellation accepts only supplied source dates and does not invent body or dates", () => {
  const e = parse({ id: "event_1", status: "cancelled", recurringEventId: "master_1", originalStartTime: { date: "2026-10-05" } });
  assert.equal(e.updated, null); assert.equal(e.start, null); assert.equal(e.summary, "");
});
test("Detail projection rebuilds nested dates and excludes raw metadata, AI output and credentials", () => {
  const e = parse(raw()); e.start.secret = "synthetic-secret";
  const detail = contract.calendarDetail({ calendar: { ...e, credentials: "synthetic-secret" }, secret: "synthetic-secret" });
  assert.equal(detail.start.dateTime, raw().start.dateTime);
  assert.ok(!JSON.stringify(detail).includes("secret")); assert.ok(!JSON.stringify(detail).includes("description"));
  assert.equal(contract.calendarDetail({ calendar: { status: "confirmed" } }), null);
});
async function clientWith(send, scopes = [scope], tokens = {}) {
  const api = load("src/lib/google/calendar-client.ts", {
    "@/lib/google/calendar-contract": contract,
    "@/lib/google/data-oauth": { CALENDAR_SCOPE: scope, refreshGoogleAccessToken: async () => { throw new Error("unexpected refresh"); } },
    "@/lib/google/connections": {
      getGoogleConnectionTokens: async () => ({ accessToken: "synthetic-secret", refreshToken: "synthetic-secret",
        scopes, accessTokenCiphertext: "synthetic", expiresAt: new Date(Date.now() + 3600000).toISOString(), ...tokens }),
      getGoogleOAuthConnection: async () => ({ id: "connection", status: "connected", scopes }),
      refreshGoogleConnectionTokens: async () => false,
    },
  }, { fetch: send });
  return api.createCalendarClient("owner", "connection");
}
test("Calendar client uses fixed primary, fields and filters; excludes every personal-data field", async () => {
  const urls = [], window = contract.collectionWindow(Date.parse("2026-10-05T00:00:00Z"));
  const client = await clientWith(async (url, options) => {
    urls.push(url); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    return Response.json(url.pathname.endsWith("event_1") ? raw() : { timeZone: "Asia/Seoul", items: [raw()] });
  });
  await client.list(window, null, AbortSignal.timeout(1000)); await client.event("event_1", AbortSignal.timeout(1000));
  assert.equal(urls[0].pathname, "/calendar/v3/calendars/primary/events");
  for (const [key, value] of Object.entries({ singleEvents: "true", showDeleted: "true", eventTypes: "default", maxResults: "50", ...window }))
    assert.equal(urls[0].searchParams.get(key), value);
  for (const name of ["attendees", "organizer", "creator", "conferenceData", "attachments", "reminders", "extendedProperties"])
    assert.ok(!urls[0].searchParams.get("fields").includes(name));
  assert.equal(window.timeMin, "2026-09-05T00:00:00.000Z"); assert.equal(window.timeMax, "2027-01-03T00:00:00.000Z");
  await assert.rejects(clientWith(async () => { throw new Error(); }, []), /CALENDAR_CONSENT_REQUIRED/);
});
test("Calendar retries only 429, 5xx and exact 403 rateLimitExceeded once; bounded Retry-After", async () => {
  for (const status of [429, 500, 503, 403]) {
    let calls = 0;
    const client = await clientWith(async () => ++calls === 1 ? Response.json({ error: { errors: [{ reason: "rateLimitExceeded" }] } },
      { status, headers: { "retry-after": "0" } }) : Response.json({ timeZone: "UTC", items: [] }));
    await client.list(contract.collectionWindow(Date.now()), null, AbortSignal.timeout(1000)); assert.equal(calls, 2);
  }
  for (const scenario of [{ status: 403, reason: "forbidden" }, { status: 404 }, { status: 429, wait: "2" }, { status: 429, wait: "invalid" }]) {
    let calls = 0;
    const client = await clientWith(async () => { calls++; return Response.json({ error: { errors: [{ reason: scenario.reason }] } },
      { status: scenario.status, headers: { "retry-after": scenario.wait ?? "0" } }); });
    await assert.rejects(client.list(contract.collectionWindow(Date.now()), null, AbortSignal.timeout(1000)));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const broken = await clientWith(async () => { calls++; throw new Error("synthetic-secret"); });
  await assert.rejects(broken.list(contract.collectionWindow(Date.now()), null, AbortSignal.timeout(1000)), /GOOGLE_UNAVAILABLE/);
  assert.equal(calls, 1);
});

// RPC mock verifies transport and observable collector behavior, not PostgreSQL execution.
function collectionHarness(pages, existing = null, rpc = async () => ({ data: { outcome: "created" }, error: null }), policy = contract) {
  const calls = [], windows = [], saves = [], extra = { classification: { user_tags: ["preserve"] }, actions: ["preserve"], evidence: ["preserve"] };
  const chain = (table) => {
    const builder = { select: () => builder, eq: (k, v) => { calls.push([table, k, v]); return builder; },
      limit: async () => ({ data: [{ id: "connection", status: "connected" }], error: null }),
      abortSignal: () => builder, maybeSingle: async () => ({ data: existing, error: null }) };
    return builder;
  };
  const collectorApi = load("src/lib/google/calendar-collection.ts", {
    "@/lib/supabase/auth": { requireUser: async () => ({ id: "owner" }) },
    "@/lib/supabase/server": { createClient: async () => ({ from: chain }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: (name, args) => {
      assert.equal(name, "persist_calendar_item"); saves.push(args); return { abortSignal: async () => rpc(args) };
    } }) },
    "@/lib/google/calendar-client": { createCalendarClient: async () => ({
      list: async (window) => { windows.push(plain(window)); const page = pages.shift(); if (page instanceof Error) throw page; return typeof page === "function" ? await page() : page; },
      event: async () => raw({ status: "cancelled", updated: next, etag: '"v2"' }),
    }) },
    "@/lib/google/gmail-message": { htmlToText }, "@/lib/google/calendar-contract": policy,
  });
  return { collect: collectorApi.collectCalendar, calls, windows, saves, extra };
}
const page = (items, nextPageToken = null) => ({ items, calendarTimezone: "Asia/Seoul", nextPageToken });
test("collector maps new ITEM, enforces ownership and only invokes Calendar persist RPC", async () => {
  const h = collectionHarness([page([raw()])]); const before = JSON.stringify(h.extra);
  const result = await h.collect(); assert.equal(result.created, 1); assert.equal(result.complete, true);
  assert.equal(h.saves[0].p_user_id, "owner"); assert.equal(h.saves[0].p_calendar_metadata.calendarId, "primary");
  assert.equal(h.saves[0].p_expected_item_updated_at, null);
  assert.ok(h.calls.some(([t,k,v]) => t === "items" && k === "user_id" && v === "owner"));
  assert.ok(h.calls.some(([t,k,v]) => t === "items" && k === "external_container_id" && v === "primary"));
  assert.equal(JSON.stringify(h.extra), before);
  assert.ok(!JSON.stringify(result).includes("Synthetic")); assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
});
for (const [name, outcome, changes] of [["reuse", "reused", {}], ["update", "updated", { updated: next, etag: '"v2"' }],
  ["time change", "updated", { updated: next, start: { dateTime: "2026-10-06T09:00:00+09:00" }, end: { dateTime: "2026-10-06T10:00:00+09:00" } }]]) {
  test(`collector ${name} uses existing snapshot and identical event identity`, async () => {
    const h = collectionHarness([page([raw(changes)])], { id: "same-item", updated_at: old, metadata: { calendar: parse(raw()) } },
      async () => ({ data: { outcome, item_id: "same-item" }, error: null }));
    const result = await h.collect(); assert.equal(result[outcome], 1);
    assert.equal(h.saves[0].p_event_id, "event_1"); assert.equal(h.saves[0].p_expected_item_updated_at, old);
  });
}
test("known cancellation uses fresh GET with prior CAS; unseen cancellation creates no ITEM", async () => {
  const h = collectionHarness([page([{ id: "event_1", status: "cancelled" }])],
    { id: "same-item", updated_at: old, metadata: { calendar: parse(raw()) } }, async () => ({ data: { outcome: "updated" }, error: null }));
  assert.equal((await h.collect()).updated, 1); assert.equal(h.saves[0].p_calendar_metadata.status, "cancelled");
  assert.equal(h.saves[0].p_expected_item_updated_at, old); assert.equal(h.saves[0].p_source_updated_at, next);
  const unseen = collectionHarness([page([{ id: "event_1", status: "cancelled" }])]);
  assert.equal((await unseen.collect()).skipped, 1); assert.equal(unseen.saves.length, 0);
});
test("stale/CAS, disconnect and unauthorized RPC rejection preserve failures without success claims", async () => {
  for (const code of ["40001", "PT409", "22023", "42501"]) {
    const errors=[];const policy={...contract,CalendarError:class extends contract.CalendarError{constructor(code){super(code);errors.push(code);}}};
    const h = collectionHarness([page([raw()])], { id: "same-item", updated_at: old, metadata: {} },
      async () => ({ data: null, error: { code, message: "synthetic-secret" } }),policy);
    const before = JSON.stringify(h.extra), result = await h.collect();
    assert.equal(result.failed, 1); assert.equal(result.complete, false); assert.equal(result.updated, 0);
    assert.equal(h.saves.length,1);assert.equal(errors[0],["40001","PT409"].includes(code)?"SOURCE_CHANGED":"STORAGE_FAILED");
    assert.equal(JSON.stringify(h.extra), before); assert.ok(!JSON.stringify(result).includes("secret"));
  }
});
test("pagination keeps fixed window, handles empty pages, stops at caps and marks partial listing", async () => {
  const h = collectionHarness([page([], "page2"), page([raw()])]);
  assert.equal((await h.collect()).pagesRead, 2); assert.deepEqual(h.windows[0], h.windows[1]);
  const capped = collectionHarness(Array.from({length:4},(_,i)=>page(Array.from({length:50},(_,j)=>raw({id:`event_${i}_${j}`})), `p${i+1}`)));
  const r = await capped.collect(); assert.equal(r.created, 200); assert.equal(r.capped, true); assert.equal(r.stopReason, "EVENT_LIMIT");
  const broken = collectionHarness([page([raw()], "p2"), new Error("synthetic-secret")]);
  const b = await broken.collect(); assert.equal(b.created, 1); assert.equal(b.complete, false); assert.equal(b.stopReason, "LIST_FAILED");
});
test("cooperative run timeout and aggregate byte cap never write incomplete content", async () => {
  const timed = collectionHarness([async () => { await new Promise(r=>setTimeout(r,30)); return page([raw()]); }], null, undefined,
    { ...contract, CALENDAR_LIMITS: { ...contract.CALENDAR_LIMITS, runMs: 10 } });
  const result = await timed.collect(); assert.equal(result.stopReason,"RUN_TIMEOUT"); assert.equal(result.unprocessed,1); assert.equal(timed.saves.length,0);
  const bounded = collectionHarness([page([raw()])],null,undefined,
    { ...contract, CALENDAR_LIMITS: { ...contract.CALENDAR_LIMITS, totalBytes: 1 } });
  const bytes = await bounded.collect(); assert.equal(bytes.stopReason,"RUN_BYTES_LIMIT"); assert.equal(bytes.capped,true); assert.equal(bounded.saves.length,0);
});
test("Calendar collect HTTP rejects arbitrary body and origin and sanitizes errors", async () => {
  let calls = 0;
  const http = { connectionResponse: (v, status=200) => Response.json(v,{status}), connectionErrorResponse: () => Response.json({error:{code:"SAFE"}},{status:401}) };
  const route = load("src/app/api/v1/connections/google/calendar/collect/route.ts", {
    "@/lib/google/calendar-collection": { collectCalendar: async () => { calls++; return {created:0}; } },
    "@/lib/google/calendar-contract": contract, "@/lib/google/http": http,
  });
  const request = body => new Request("https://app.invalid/api", {method:"POST",headers:{origin:"https://app.invalid"},...(body===undefined?{}:{body})});
  for (const body of ['{"calendarId":"other"}', '{"userId":"other"}', '{"timeMin":"anything"}', '{"credential":"secret"}', '[]', 'null', 'x'.repeat(65)])
    assert.equal((await route.POST(request(body))).status, 400);
  assert.equal(calls, 0); assert.equal((await route.POST(request())).status, 200); assert.equal((await route.POST(request('{}'))).status, 200);
  assert.equal((await route.POST(new Request("https://app.invalid/api",{method:"POST",headers:{origin:"https://evil.invalid"}}))).status,403);
});
test("SQL draft statically enforces Calendar identity, ownership, CAS, version ordering, cancellation and service-only rights", () => {
  const sql = readFileSync(new URL('../tests/fixtures/sql/calendar/persist_calendar_item.sql',import.meta.url),'utf8');
  for (const snippet of ["user_id=p_user_id", "provider='google' and status='connected' for update", scope,
    "private.google_connection_tokens", "source='calendar' and external_container_id='primary'", "p_expected_item_updated_at",
    "p_source_updated_at<=v_item.source_updated_at", "Stale or unordered source snapshot", "'outcome','reused'",
    "if v_status='cancelled' then", "from public,anon,authenticated,service_role", "to service_role", "set search_path=''"])
    assert.ok(sql.includes(snippet), snippet);
  assert.ok(!/\b(?:alter|drop)\s+(?:table|policy|index)|(?:insert into|update|delete from)\s+public\.(?:classifications|actions|action_sources)/i.test(sql));
  assert.ok(!sql.includes("now()"));
  assert.equal(sql,readFileSync(new URL('../supabase/migrations/20261005055754_persist_calendar_item.sql',import.meta.url),'utf8'));
  assert.equal(readFileSync(new URL('../tests/fixtures/sql/calendar/google_calendar_scope_boundary.sql',import.meta.url),'utf8'),
    readFileSync(new URL('../supabase/migrations/20261005055748_google_calendar_scope_boundary.sql',import.meta.url),'utf8'));
});
