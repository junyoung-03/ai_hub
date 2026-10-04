import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const owner = "test-owner";
const connectionId = "test-connection";
let currentUser = owner;
let connected = true;
let bundle = null;
let lastRpcArgs = null;
const oldKey = process.env.GOOGLE_DATA_TOKEN_ENCRYPTION_KEY;
process.env.GOOGLE_DATA_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

function loadModule(path, imports = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, Buffer, process,
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(imports, name)) return imports[name];
      return require(name);
    },
  });
  return exports;
}

const encryption = loadModule("../src/lib/google/token-encryption.ts");
const cookieClient = {
  from() {
    const query = {
      select() { return query; },
      eq() { return query; },
      async maybeSingle() {
        return { data: connected ? { provider_account_id: "test-google-sub" } : null, error: null };
      },
    };
    return query;
  },
  async rpc(name) {
    assert.equal(name, "disconnect_google_connection");
    connected = false;
    bundle = null;
    return { data: true, error: null };
  },
};
const adminClient = {
  async rpc(name, args) {
    assert.equal(args.p_user_id, owner);
    lastRpcArgs = args;
    if (name === "get_google_connection_tokens") {
      return { data: bundle ? [bundle] : [], error: null };
    }
    assert.ok(["upsert_google_connection", "refresh_google_connection_tokens"].includes(name));
    bundle = {
      access_token_ciphertext: args.p_access_token_ciphertext,
      access_token_iv: args.p_access_token_iv,
      access_token_tag: args.p_access_token_tag,
      refresh_token_ciphertext: args.p_refresh_token_ciphertext ?? bundle?.refresh_token_ciphertext,
      refresh_token_iv: args.p_refresh_token_iv ?? bundle?.refresh_token_iv,
      refresh_token_tag: args.p_refresh_token_tag ?? bundle?.refresh_token_tag,
      token_expires_at: args.p_token_expires_at,
      encryption_version: args.p_encryption_version,
    };
    return { data: name === "upsert_google_connection" ? connectionId : true, error: null };
  },
};
const connections = loadModule("../src/lib/google/connections.ts", {
  "@/lib/supabase/server": { createClient: async () => cookieClient },
  "@/lib/supabase/admin": { createAdminClient: () => adminClient },
  "@/lib/supabase/auth": { requireUser: async () => ({ id: currentUser }) },
  "@/lib/google/token-encryption": encryption,
});

try {
  const key = encryption.getGoogleTokenEncryptionKey();
  const sealed = encryption.sealGoogleToken("synthetic-token", "owner-context", key);
  assert.equal(encryption.openGoogleToken(sealed, "owner-context", key), "synthetic-token");
  assert.throws(() => encryption.openGoogleToken(sealed, "other-context", key));
  assert.throws(() => encryption.openGoogleToken({ ...sealed, tag: randomBytes(16).toString("base64url") }, "owner-context", key));

  const candidate = {
    userId: owner, providerAccountId: "test-google-sub", accountEmail: "test@example.invalid",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"], gmailHistoryId: "1001",
    accessToken: "synthetic-access-1", refreshToken: "synthetic-refresh-1",
    tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  await connections.persistGoogleConnection(candidate);
  assert.notEqual(bundle.access_token_ciphertext, candidate.accessToken);
  assert.notEqual(bundle.refresh_token_ciphertext, candidate.refreshToken);
  assert.equal((await connections.getGoogleConnectionTokens(owner, connectionId)).accessToken, candidate.accessToken);

  const savedRefresh = [bundle.refresh_token_ciphertext, bundle.refresh_token_iv, bundle.refresh_token_tag];
  await connections.refreshGoogleConnectionTokens(owner, connectionId, {
    accessToken: "synthetic-access-2", refreshToken: null, tokenExpiresAt: candidate.tokenExpiresAt,
  });
  assert.equal(lastRpcArgs.p_refresh_token_ciphertext, null);
  assert.equal(lastRpcArgs.p_refresh_token_iv, null);
  assert.equal(lastRpcArgs.p_refresh_token_tag, null);
  assert.deepEqual([bundle.refresh_token_ciphertext, bundle.refresh_token_iv, bundle.refresh_token_tag], savedRefresh);
  assert.equal((await connections.getGoogleConnectionTokens(owner, connectionId)).accessToken, "synthetic-access-2");
  await connections.refreshGoogleConnectionTokens(owner, connectionId, {
    accessToken: "synthetic-access-3", refreshToken: "synthetic-refresh-3", tokenExpiresAt: candidate.tokenExpiresAt,
  });
  assert.equal((await connections.getGoogleConnectionTokens(owner, connectionId)).refreshToken, "synthetic-refresh-3");

  currentUser = "other-user";
  await assert.rejects(connections.persistGoogleConnection(candidate), /ownership mismatch/);
  await assert.rejects(connections.getGoogleConnectionTokens(owner, connectionId), /ownership mismatch/);
  await assert.rejects(connections.refreshGoogleConnectionTokens(owner, connectionId, candidate), /ownership mismatch/);
  currentUser = owner;
  await connections.disconnectGoogleConnection(connectionId);
  assert.equal(bundle, null);
  assert.equal(await connections.getGoogleConnectionTokens(owner, connectionId), null);
  assert.equal(await connections.refreshGoogleConnectionTokens(owner, connectionId, candidate), false);
  console.log("PASS: AES-GCM roundtrip/tamper rejection, encrypted RPC payloads, owner checks, refresh preservation/replacement, authenticated disconnect.");
  console.log("Isolated tests only; no Google requests or database writes.");
} finally {
  if (oldKey === undefined) delete process.env.GOOGLE_DATA_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_DATA_TOKEN_ENCRYPTION_KEY = oldKey;
}
