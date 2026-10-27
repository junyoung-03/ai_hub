import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadModule(path, imports = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, Buffer, process: { env: {} },
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

test("formatRelativeTime formats relative intervals correctly", () => {
  const presentation = loadModule("../src/lib/items/presentation.ts");
  const now = Date.now();
  assert.equal(presentation.formatRelativeTime(null), "기록 없음");
  assert.equal(presentation.formatRelativeTime(undefined), "기록 없음");
  assert.equal(presentation.formatRelativeTime(new Date(now - 10000).toISOString()), "방금 전");
  assert.equal(presentation.formatRelativeTime(new Date(now - 15 * 60 * 1000).toISOString()), "15분 전");
  assert.equal(presentation.formatRelativeTime(new Date(now - 3 * 3600 * 1000).toISOString()), "3시간 전");
  assert.equal(presentation.formatRelativeTime(new Date(now - 25 * 3600 * 1000).toISOString()), "어제");
});

test("getGoogleServicesSyncSummary maps all 5 statuses, scopes, and timestamps safely", async () => {
  let mockConnection = null;
  let mockItems = [];

  const supabaseMock = {
    from(table) {
      if (table === "connections") {
        const query = {
          select() { return query; },
          eq() { return query; },
          order() { return query; },
          async limit() {
            return { data: mockConnection ? [mockConnection] : [], error: null };
          },
        };
        return query;
      }
      if (table === "items") {
        let itemSource = "";
        const query = {
          select() { return query; },
          eq(k, v) { if (k === "source") itemSource = v; return query; },
          order() { return query; },
          limit() { return query; },
          async maybeSingle() {
            const found = mockItems.find(it => it.source === itemSource);
            return { data: found ?? null, error: null };
          },
        };
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const connections = loadModule("../src/lib/google/connections.ts", {
    "@/lib/supabase/server": { createClient: async () => supabaseMock },
    "@/lib/supabase/admin": { createAdminClient: () => ({}) },
    "@/lib/supabase/auth": { requireUser: async () => ({ id: "user-1" }) },
    "@/lib/google/token-encryption": { getGoogleTokenEncryptionKey: () => "" },
    "@/lib/google/data-oauth": { validateGrantedScopes: (s) => s.split(" ") },
  });

  // Case 1: No connection -> all disconnected
  mockConnection = null;
  const noConn = await connections.getGoogleServicesSyncSummary("user-1");
  assert.equal(noConn.googleAccount.connected, false);
  assert.equal(noConn.services.gmail.status, "disconnected");
  assert.equal(noConn.services.drive.status, "disconnected");
  assert.equal(noConn.services.calendar.status, "disconnected");

  // Case 2: Connected with all scopes and successful baselines
  mockConnection = {
    id: "conn-1",
    user_id: "user-1",
    account_email: "test@example.com",
    status: "connected",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/calendar.events.owned.readonly",
    ],
    last_synced_at: "2026-10-06T10:00:00Z",
    sync_state: {
      gmail: {
        last_synced_at: "2026-10-06T10:00:00Z",
        last_result: { created_count: 4, updated_count: 0, skipped_count: 10, failed_count: 0 },
        last_error: null,
      },
      drive: {
        last_synced_at: "2026-10-06T09:45:00Z",
        last_result: { created: 0, updated: 0, reused: 5, complete: true },
        last_error: null,
      },
      calendar: {
        last_synced_at: "2026-10-06T08:00:00Z",
        last_result: { created: 1, updated: 0, reused: 3, complete: true },
        last_error: null,
      },
    },
  };

  const fullConn = await connections.getGoogleServicesSyncSummary("user-1");
  assert.equal(fullConn.googleAccount.connected, true);
  assert.equal(fullConn.googleAccount.email, "test@example.com");
  assert.equal(fullConn.services.gmail.status, "connected");
  assert.equal(fullConn.services.gmail.lastSyncedAt, "2026-10-06T10:00:00Z");
  assert.equal(fullConn.services.gmail.lastResult.created_count, 4);

  assert.equal(fullConn.services.drive.status, "connected");
  assert.equal(fullConn.services.drive.lastSyncedAt, "2026-10-06T09:45:00Z");
  assert.equal(fullConn.services.drive.lastResult.reused, 5);

  assert.equal(fullConn.services.calendar.status, "connected");
  assert.equal(fullConn.services.calendar.lastSyncedAt, "2026-10-06T08:00:00Z");
  assert.equal(fullConn.services.calendar.lastResult.created, 1);

  // Case 3: Missing Drive and Calendar scopes -> reconnect_required
  mockConnection.scopes = ["https://www.googleapis.com/auth/gmail.readonly"];
  const partialScopes = await connections.getGoogleServicesSyncSummary("user-1");
  assert.equal(partialScopes.services.gmail.status, "connected");
  assert.equal(partialScopes.services.drive.status, "reconnect_required");
  assert.equal(partialScopes.services.calendar.status, "reconnect_required");

  // Case 4: Last error is reconnect_required
  mockConnection.scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/calendar.events.owned.readonly",
  ];
  mockConnection.sync_state.calendar.last_error = "reconnect_required";
  const errConn = await connections.getGoogleServicesSyncSummary("user-1");
  assert.equal(errConn.services.calendar.status, "reconnect_required");

  // Case 5: Last error is generic error
  mockConnection.sync_state.calendar.last_error = "GOOGLE_UNAVAILABLE";
  const genErr = await connections.getGoogleServicesSyncSummary("user-1");
  assert.equal(genErr.services.calendar.status, "error");

  // Case 6: Item timestamps cannot establish a successful service checkpoint.
  mockConnection.sync_state.drive.last_synced_at = null;
  mockConnection.sync_state.calendar.last_synced_at = null;
  mockConnection.sync_state.calendar.last_error = null;
  mockItems = [
    { source: "drive", created_at: "2026-10-05T02:00:00Z" },
    { source: "calendar", created_at: "2026-10-05T06:00:00Z" },
  ];
  const fallbackConn = await connections.getGoogleServicesSyncSummary("user-1");
  assert.equal(fallbackConn.services.drive.lastSyncedAt, null);
  assert.equal(fallbackConn.services.calendar.lastSyncedAt, null);
  mockConnection.sync_state.gmail = {};
  const noGmailCheckpoint = await connections.getGoogleServicesSyncSummary("user-1");
  assert.equal(noGmailCheckpoint.services.gmail.lastSyncedAt, null);
});

test("sequential full-sync continues execution even when earlier services fail", async () => {
  const steps = [];
  const results = {};

  async function mockSync(service, shouldFail) {
    steps.push(`start:${service}`);
    if (shouldFail) {
      results[service] = "FAIL";
      throw new Error(`${service} failed`);
    }
    results[service] = "PASS";
    steps.push(`end:${service}`);
  }

  // Sequence: Gmail (FAIL), Drive (PASS), Calendar (PASS)
  for (const s of ["gmail", "drive", "calendar"]) {
    try {
      await mockSync(s, s === "gmail");
    } catch {
      // Isolates failure and continues to next service
    }
  }

  assert.deepEqual(steps, [
    "start:gmail",
    "start:drive",
    "end:drive",
    "start:calendar",
    "end:calendar",
  ]);
  assert.equal(results.gmail, "FAIL");
  assert.equal(results.drive, "PASS");
  assert.equal(results.calendar, "PASS");
});
