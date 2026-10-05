import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
nextEnv.loadEnvConfig(process.cwd());
export function load(path, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, { exports, Buffer, TextEncoder, TextDecoder, URL, URLSearchParams, Response, Request,
    AbortSignal, AbortController, Date, process, fetch, setTimeout, clearTimeout,
    require(name) {
      if (name === "server-only") return {};
      if (name in imports) return imports[name];
      if (name.startsWith("node:") || name === "@supabase/supabase-js") return require(name);
      throw new Error("Unexpected live dependency.");
    },
  });
  return exports;
}
export async function existingGoogleTest() {
  const env = load("src/lib/supabase/env.ts");
  if (new URL(env.getSupabaseConfig().url).hostname !== "oclzdppdiljbojvqtkeu.supabase.co") throw new Error("Development target required.");
  const adminModule = load("src/lib/supabase/admin.ts", { "@/lib/supabase/env": env });
  const admin = adminModule.createAdminClient();
  const { data, error } = await admin.from("connections").select("id,user_id,provider_account_id,status,scopes,sync_state,last_synced_at")
    .eq("provider", "google").eq("status", "connected").limit(2);
  if (error || data?.length !== 1) throw new Error("Unique existing test connection required.");
  const connection = data[0];
  const { count, error: itemError } = await admin.from("items").select("id", { count: "exact", head: true })
    .eq("user_id", connection.user_id).eq("connection_id", connection.id).eq("source", "gmail");
  if (itemError || !count) throw new Error("Existing Gmail test history required.");
  const dataOAuth = load("src/lib/google/data-oauth.ts");
  const auth = { async requireUser() { return { id: connection.user_id }; } };
  const server = { async createClient() { return admin; } };
  const connections = load("src/lib/google/connections.ts", {
    "@/lib/supabase/auth": auth, "@/lib/supabase/server": server, "@/lib/supabase/admin": adminModule,
    "@/lib/google/token-encryption": load("src/lib/google/token-encryption.ts"), "@/lib/google/data-oauth": dataOAuth,
  });
  return { connection, admin, adminModule, dataOAuth, auth, server, connections };
}
