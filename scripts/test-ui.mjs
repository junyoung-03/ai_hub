import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../src/components/search/search-results.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
vm.runInNewContext(source, { exports, Date, require(name) {
  if (name === "@/lib/items/presentation") return {};
  if (name === "next/link") return () => null;
  return require(name);
} });
const { deadlineLabel } = exports;
const now = Date.parse("2026-10-05T00:30:00+09:00");
const action = { status: "open", deadlineStatus: "confirmed", deadlineDate: "2026-10-05", deadlineAt: null };
test("D-Day uses the Korean calendar day across the UTC boundary", () => {
  assert.equal(deadlineLabel(action, now), "D-DAY");
  assert.equal(deadlineLabel({ ...action, deadlineDate: "2026-10-06" }, now), "D-1");
  assert.equal(deadlineLabel({ ...action, deadlineDate: "2026-10-04" }, now), "기한 초과 +1일");
});
test("an exact expired time is not displayed as an upcoming same-day deadline", () => {
  assert.equal(deadlineLabel({ ...action, deadlineAt: "2026-10-05T00:00:00+09:00" }, now), "마감 시간 지남");
  assert.equal(deadlineLabel({ ...action, deadlineDate: null, deadlineAt: "2026-10-05T15:30:00Z" }, now), "D-1");
});
test("review and absent deadlines never become D-Day; completed status is preserved", () => {
  assert.equal(deadlineLabel({ ...action, deadlineStatus: "needs_review" }, now), "마감일 확인 필요");
  assert.equal(deadlineLabel({ ...action, deadlineStatus: "none" }, now), "마감일 없음");
  assert.equal(deadlineLabel({ ...action, status: "completed" }, now), "완료");
});

test("connection capability projection requires both Drive grants and omits raw scopes/private fields", async () => {
  const connectionSource = ts.transpileModule(readFileSync(new URL("../src/lib/google/connections.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const connectionExports = {}; let scopes = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"];
  const query = { select(fields) { assert.equal(fields, "id,status,account_email,last_synced_at,scopes"); return query; },
    eq(key,value) { if(key === "user_id") assert.equal(value,"owner"); return query; }, order() { return query; },
    async limit() { return { data: [{ id:"connection",status:"connected",account_email:"test@example.invalid",last_synced_at:null,scopes,privateField:"must-not-return" }], error:null }; } };
  vm.runInNewContext(connectionSource,{exports:connectionExports,require(name){
    if(name === "@/lib/supabase/server") return {createClient:async()=>({from:()=>query})};
    return {};
  }});
  const partial = await connectionExports.getGoogleConnectionSummary("owner");
  assert.equal(partial.capabilities.gmail,true); assert.equal(partial.capabilities.drive,false); assert.equal(partial.capabilities.calendar,false);
  assert.equal("scopes" in partial,false); assert.equal("privateField" in partial,false);
  scopes = [...scopes,"https://www.googleapis.com/auth/documents.readonly","https://www.googleapis.com/auth/calendar.events.owned.readonly"];
  const complete = await connectionExports.getGoogleConnectionSummary("owner");
  assert.equal(complete.capabilities.drive,true); assert.equal(complete.capabilities.calendar,true);
});
