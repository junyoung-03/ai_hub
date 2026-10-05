// Opt-in live development test. Refreshes credentials for ONE explicitly selected
// account; expiry is injected in memory, never changed in the database.
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as parse5 from "parse5";

nextEnv.loadEnvConfig(process.cwd());
const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(source, { exports, Buffer, TextDecoder, URL, URLSearchParams, Response, AbortSignal, Date, process, fetch,
    require(name) {
      if (name === "server-only") return {};
      if (name in imports) return imports[name];
      if (name === "parse5") return parse5;
      if (name.startsWith("node:") || name === "@supabase/supabase-js") return require(name);
      throw new Error("Unexpected test dependency.");
    },
  });
  return exports;
}

try {
  const existing = process.argv.includes("--existing-test-connection");
  const email = process.env.GMAIL_REFRESH_TEST_EMAIL?.trim();
  if ((!email && !existing) || process.env.GMAIL_REFRESH_TEST_PROJECT !== "oclzdppdiljbojvqtkeu") throw new Error("Explicit development test target required.");
  const env = load("src/lib/supabase/env.ts");
  if (new URL(env.getSupabaseConfig().url).hostname !== "oclzdppdiljbojvqtkeu.supabase.co") throw new Error("Development target mismatch.");
  const adminModule = load("src/lib/supabase/admin.ts", { "@/lib/supabase/env": env });
  const admin = adminModule.createAdminClient();
  let query = admin.from("connections").select("id,user_id,scopes,sync_state,last_synced_at")
    .eq("provider", "google").eq("status", "connected");
  if (!existing) query = query.eq("account_email", email);
  const { data: candidates, error } = await query.limit(2);
  if (error || candidates?.length !== 1) throw new Error("Unique test connection required.");
  const connection = candidates[0];
  const { count, error: itemError } = await admin.from("items").select("id", { count: "exact", head: true })
    .eq("user_id", connection.user_id).eq("connection_id", connection.id).eq("source", "gmail");
  if (itemError || !count) throw new Error("Existing Gmail test history required.");
  const encryption = load("src/lib/google/token-encryption.ts");
  const dataOAuth = load("src/lib/google/data-oauth.ts");
  // Only the auth/cookie adapters are replaced for the CLI test. Production
  // encryption, owner checks, narrow RPCs, refresh grant and Gmail client run.
  const connections = load("src/lib/google/connections.ts", {
    "@/lib/supabase/auth": { async requireUser() { return { id: connection.user_id }; } },
    "@/lib/supabase/server": { async createClient() { return admin; } },
    "@/lib/supabase/admin": adminModule, "@/lib/google/token-encryption": encryption,
    "@/lib/google/data-oauth": dataOAuth,
  });
  const before = await connections.getGoogleConnectionTokens(connection.user_id, connection.id);
  if (!before) throw new Error("Test token unavailable.");
  let persisted = false;
  const gmailModule = load("src/lib/google/gmail-client.ts", {
    "@/lib/google/gmail-message": load("src/lib/google/gmail-message.ts"),
    "@/lib/google/data-oauth": dataOAuth,
    "@/lib/google/connections": {
      ...connections,
      async getGoogleConnectionTokens(userId, connectionId) {
        const bundle = await connections.getGoogleConnectionTokens(userId, connectionId);
        return bundle ? { ...bundle, expiresAt: new Date(Date.now() - 1000).toISOString() } : null;
      },
      async refreshGoogleConnectionTokens(...args) {
        persisted = await connections.refreshGoogleConnectionTokens(...args);
        return persisted;
      },
    },
  });
  const gmail = await gmailModule.createGmailClient(connection.user_id, connection.id);
  await gmail.profile(); // No list/get/attachment request in this test.
  const after = await connections.getGoogleConnectionTokens(connection.user_id, connection.id);
  if (!persisted || !after || Date.parse(after.expiresAt) <= Date.now()) throw new Error("Refresh verification failed.");
  const { data: state, error: stateError } = await admin.from("connections").select("scopes,sync_state,last_synced_at")
    .eq("id", connection.id).single();
  if (stateError || JSON.stringify(state.scopes) !== JSON.stringify(connection.scopes)
    || JSON.stringify(state.sync_state) !== JSON.stringify(connection.sync_state)
    || state.last_synced_at !== connection.last_synced_at || after.refreshToken !== before.refreshToken)
    throw new Error("Gmail state preservation failed.");
  console.log("PASS: real Google refresh, encrypted RPC persistence, and Gmail profile with refreshed access.");
  console.log("PASS: refresh token, Gmail scopes, entire sync_state/history_id/initial_collection and last_synced_at preserved.");
  console.log("Expiry condition: injected in server test memory; DB expiry was not falsified.");
} catch {
  console.error("FAIL: live refresh verification failed; credential/error payloads suppressed.");
  process.exitCode = 1;
}
