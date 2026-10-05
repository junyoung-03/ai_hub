// Drive-3 isolated tests. All Google/DB transports are mocked; no live credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";
const driveScope = "https://www.googleapis.com/auth/drive.metadata.readonly";
const docsScope = "https://www.googleapis.com/auth/documents.readonly";
const fullScopes = ["openid", "email", "profile", gmailScope, driveScope, docsScope];
const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "http://localhost:3000/api/v1/connections/google/callback" };
const environment = { env: { GOOGLE_DATA_CLIENT_ID: config.clientId, GOOGLE_DATA_CLIENT_SECRET: config.clientSecret, GOOGLE_DATA_REDIRECT_URI: config.redirectUri } };
environment.env.GOOGLE_DATA_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
function load(path, imports = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  runInNewContext(outputText, { exports, Buffer, URL, URLSearchParams, Request, Response, AbortSignal, Date,
    process: environment, ...globals, require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name === "node:crypto" || name === "next/server") return require(name);
      throw new Error(`Unexpected import: ${name}`);
    } });
  return exports;
}
const oauth = load("src/lib/google/data-oauth.ts");
const stateApi = load("src/lib/google/oauth-state.ts");
const timestamp = "2026-10-04T12:00:00.123456+00:00";
const context = { purpose: "drive_scope_upgrade", connectionId, accountId: "synthetic-google-sub", connectionUpdatedAt: timestamp };
const current = () => ({ id: connectionId, provider_account_id: context.accountId, status: "connected", updated_at: timestamp, scopes: [gmailScope] });

test("initial Gmail authorization is unchanged; Drive upgrade and reconnect request only approved scopes", () => {
  const initial = new URL(oauth.createGoogleAuthorizationUrl(config, "state"));
  assert.equal(initial.searchParams.get("scope"), ["openid", "email", "profile", gmailScope].join(" "));
  const upgrade = new URL(oauth.createGoogleAuthorizationUrl(config, "state", "drive_scope_upgrade"));
  assert.deepEqual(upgrade.searchParams.get("scope").split(" "), fullScopes);
  assert.equal(upgrade.searchParams.get("include_granted_scopes"), "true");
  const reconnect = new URL(oauth.createGoogleAuthorizationUrl(config, "state", "connect", fullScopes));
  assert.deepEqual(reconnect.searchParams.get("scope").split(" "), fullScopes);
  assert.ok(!upgrade.toString().includes("drive.file"));
});

test("granted scopes require Gmail, both Drive capabilities and existing data capabilities", () => {
  for (const scopes of [fullScopes.filter((x) => x !== gmailScope), fullScopes.filter((x) => x !== docsScope),
    fullScopes.filter((x) => x !== driveScope), [...fullScopes, "https://www.googleapis.com/auth/drive"]])
    assert.throws(() => oauth.validateGrantedScopes(scopes.join(" "), "drive_scope_upgrade"), /INVALID_SCOPE/);
  assert.throws(() => oauth.validateGrantedScopes(gmailScope, "connect", fullScopes), /INVALID_SCOPE/);
  assert.throws(() => oauth.validateGrantedScopes([gmailScope, driveScope].join(" ")), /INVALID_SCOPE/);
  assert.equal(oauth.validateGrantedScopes([...fullScopes, gmailScope].join(" "), "drive_scope_upgrade").length, 6);
});

test("signed OAuth purpose binds user, connection, account and timestamp; tamper and expiry fail", () => {
  const created = stateApi.createGoogleOAuthState(userId, config.clientSecret, context);
  assert.equal(stateApi.readGoogleOAuthState(created.state, created.cookieValue, userId, config.clientSecret).connectionId, connectionId);
  assert.equal(stateApi.readGoogleOAuthState(created.state, created.cookieValue, connectionId, config.clientSecret), null);
  const [payload, signature] = created.cookieValue.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), purpose: "connect" })).toString("base64url");
  assert.equal(stateApi.readGoogleOAuthState(created.state, `${tampered}.${signature}`, userId, config.clientSecret), null);
  class ExpiredDate extends Date { static now() { return Date.now() + 600001; } }
  const expired = load("src/lib/google/oauth-state.ts", {}, { Date: ExpiredDate });
  assert.equal(expired.readGoogleOAuthState(created.state, created.cookieValue, userId, config.clientSecret), null);
});

test("refresh proves returned scopes; missing, partial or downgraded grants are rejected without exposing raw errors", async () => {
  for (const scope of [undefined, gmailScope, [driveScope, docsScope].join(" ")]) {
    const refreshApi = load("src/lib/google/data-oauth.ts", {}, { fetch: async () => Response.json({
      access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600, scope,
    }) });
    await assert.rejects(refreshApi.refreshGoogleAccessToken("synthetic-refresh", fullScopes, true), /TOKEN_REFRESH_FAILED/);
  }
  const refreshApi = load("src/lib/google/data-oauth.ts", {}, { fetch: async () => Response.json({
    access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600, scope: fullScopes.join(" "),
  }) });
  assert.equal((await refreshApi.refreshGoogleAccessToken("synthetic-refresh", fullScopes, true)).scopes.length, 6);
});

function callbackHarness(options = {}) {
  const calls = [], writes = [];
  const connection = { ...current(), ...options.connection };
  const scope = options.scope ?? fullScopes.join(" ");
  const oauthMock = {
    ...oauth, getGoogleDataOAuthConfig: () => config,
    async exchangeGoogleAuthorizationCode(_config, code, purpose, preserved) {
      calls.push("exchange"); assert.equal(code, "synthetic-code");
      return { accessToken: "synthetic-new", refreshToken: options.omitRefresh ? null : "synthetic-new-refresh",
        expiresAt: timestamp, scopes: oauth.validateGrantedScopes(scope, purpose, preserved) };
    },
    async fetchGoogleIdentity() { calls.push("identity"); return { providerAccountId: options.otherAccount ? "other-sub" : context.accountId, email: "fixture@example.invalid" }; },
    async fetchGmailProfile() { calls.push("profile"); return { emailAddress: "fixture@example.invalid", historyId: "999" }; },
    async refreshGoogleAccessToken(token, required, strict) {
      calls.push("refresh"); assert.equal(token, options.omitRefresh ? "synthetic-old-refresh" : "synthetic-new-refresh");
      assert.equal(strict, true); assert.ok(required.includes(docsScope));
      if (options.refreshFailure) throw new oauth.GoogleDataOAuthError("TOKEN_REFRESH_FAILED");
      return { accessToken: "synthetic-refreshed", refreshToken: null, tokenExpiresAt: timestamp,
        scopes: options.refreshScope ?? fullScopes };
    },
  };
  class StorageError extends Error {}
  const connections = {
    GoogleConnectionStorageUnavailableError: StorageError,
    async getGoogleOAuthConnection() { return connection; },
    async getGoogleConnectionTokens() { calls.push("tokens"); return { refreshToken: "synthetic-old-refresh", accessTokenCiphertext: "synthetic-old-cipher" }; },
    async persistGoogleScopeUpgrade(candidate) { writes.push(candidate); },
    async persistGoogleConnection(candidate) { writes.push(candidate); },
  };
  class AuthError extends Error {}
  const route = load("src/app/api/v1/connections/google/callback/route.ts", {
    "@/lib/google/connections": connections, "@/lib/google/data-oauth": oauthMock,
    "@/lib/google/oauth-state": stateApi,
    "@/lib/supabase/auth": { AuthenticationRequiredError: AuthError, async requireUser() { return { id: userId }; } },
  });
  const created = stateApi.createGoogleOAuthState(userId, config.clientSecret, options.normal ? undefined : context);
  const request = (query = "") => new NextRequest(`http://localhost:3000/api/v1/connections/google/callback?state=${created.state}&code=synthetic-code${query}`, {
    headers: { Cookie: `${stateApi.GOOGLE_OAUTH_STATE_COOKIE}=${created.cookieValue}` },
  });
  return { route, request, calls, writes };
}

test("scope upgrade saves verified refreshed credentials without passing any Gmail checkpoint", async () => {
  for (const omitRefresh of [false, true]) {
    const h = callbackHarness({ omitRefresh });
    const response = await h.route.GET(h.request());
    assert.equal(response.headers.get("location"), "/settings?connection=drive_connected");
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].accessToken, "synthetic-refreshed");
    assert.equal(h.writes[0].expectedAccessTokenCiphertext, "synthetic-old-cipher");
    assert.ok(!("gmailHistoryId" in h.writes[0]));
    assert.ok(!response.headers.get("location").includes("synthetic"));
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }
});

test("denial, Gmail loss, partial Drive grant, wrong account, failed refresh and disconnect cannot reach storage", async () => {
  const cases = [
    { options: {}, query: "&error=access_denied&error_description=private" },
    { options: { scope: [driveScope, docsScope].join(" ") } },
    { options: { scope: [gmailScope, driveScope].join(" ") } },
    { options: { otherAccount: true } },
    { options: { refreshFailure: true } },
    { options: { refreshScope: [gmailScope] } },
    { options: { connection: { status: "disconnected" } } },
    { options: { connection: { updated_at: "2026-10-04T13:00:00Z" } } },
  ];
  for (const entry of cases) {
    const h = callbackHarness(entry.options);
    const response = await h.route.GET(h.request(entry.query));
    assert.equal(h.writes.length, 0);
    assert.notEqual(response.headers.get("location"), "/settings?connection=drive_connected");
    assert.ok(!response.headers.get("location").includes("private"));
    if (entry.query || entry.options?.connection) assert.ok(!h.calls.includes("exchange"));
    if (entry.options?.otherAccount) assert.ok(!h.calls.includes("refresh"));
  }
});

test("normal Gmail callback and reconnect still use the existing persistence contract", async () => {
  const h = callbackHarness({ normal: true, scope: gmailScope });
  assert.equal((await h.route.GET(h.request())).headers.get("location"), "/settings?connection=connected");
  assert.equal(h.writes[0].gmailHistoryId, "999");
  assert.ok(!h.calls.includes("refresh"));
});

test("authorize rejects cross-origin/ambiguous bodies; upgrade requires an existing connection", async () => {
  let available = true;
  const route = load("src/app/api/v1/connections/google/authorize/route.ts", {
    "@/lib/google/connections": { assertGoogleConnectionStorageReady() {}, async getGoogleOAuthConnection() { return available ? current() : null; } },
    "@/lib/google/data-oauth": { ...oauth, getGoogleDataOAuthConfig: () => config },
    "@/lib/google/oauth-state": stateApi,
    "@/lib/google/http": { connectionResponse: (value, status) => Response.json(value, { status }), connectionErrorResponse: () => Response.json({}, { status: 500 }) },
    "@/lib/supabase/auth": { async requireUser() { return { id: userId }; } },
  });
  const request = (body, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/v1/connections/google/authorize", {
    method: "POST", headers: { origin }, ...(body === undefined ? {} : { body }),
  });
  assert.equal((await route.POST(request(undefined, "https://foreign.example"))).status, 403);
  for (const body of ['{"purpose":"drive_scope_upgrade","user_id":"foreign"}', "null", "[]", "invalid"])
    assert.equal((await route.POST(request(body))).status, 400);
  const response = await route.POST(request('{"purpose":"drive_scope_upgrade"}'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload), ["authorizationUrl"]);
  assert.ok(new URL(payload.authorizationUrl).searchParams.get("scope").includes(docsScope));
  available = false;
  assert.equal((await route.POST(request('{"purpose":"drive_scope_upgrade"}'))).status, 409);
  assert.equal((await route.POST(request())).status, 200);
});

test("scope SQL and unapplied ITEM draft preserve schema, privileges, checkpoints and concurrency guards", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261004145244_google_drive_oauth_scope_boundary.sql", import.meta.url), "utf8");
  const draft = readFileSync(new URL("../docs/drafts/drive/persist_drive_item.sql", import.meta.url), "utf8");
  for (const source of [sql, draft]) {
    assert.doesNotMatch(source, /(?:create|alter|drop)\s+(?:table|index|policy|type)\b/i);
    assert.equal((source.match(/\$\$/g) ?? []).length % 2, 0);
    assert.match(source, /security definer set search_path=''/i);
    assert.match(source, /from public,anon,authenticated,service_role/i);
    assert.doesNotMatch(source, /grant execute[^;]+to (?:anon|authenticated|public)\b/i);
    assert.match(source, /for update/i);
  }
  assert.match(sql, /cardinality\(p_scopes\) > 8/);
  assert.match(sql, /sync_state=v_connection.sync_state/);
  assert.match(sql, /last_synced_at=v_connection.last_synced_at/);
  assert.match(sql, /v_ciphertext is distinct from p_expected_access_token_ciphertext/);
  assert.match(draft, /v_item.source_updated_at>p_source_updated_at/);
  assert.match(draft, /v_item.updated_at is distinct from p_expected_item_updated_at/);
  assert.doesNotMatch(draft, /(?:update|insert into|delete from) public\.(?:classifications|actions|action_sources)\b/i);
});

test("real scope persistence helper encrypts credentials and rejects foreign/stale/disconnected/partial candidates before RPC", async () => {
  const encryption = load("src/lib/google/token-encryption.ts");
  let connection = current(), principal = userId;
  const calls = [];
  const cookieClient = { from() {
    const query = { select() { return query; }, eq() { return query; }, order() { return query; },
      async limit() { return { data: [connection], error: null }; } };
    return query;
  } };
  const connectionsApi = load("src/lib/google/connections.ts", {
    "@/lib/google/data-oauth": oauth,
    "@/lib/google/token-encryption": encryption,
    "@/lib/supabase/server": { createClient: async () => cookieClient },
    "@/lib/supabase/auth": { requireUser: async () => ({ id: principal }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ async rpc(name, args) {
      calls.push({ name, args }); return { data: connectionId, error: null };
    } }) },
  });
  const candidate = { userId, connectionId, providerAccountId: context.accountId, accountEmail: "fixture@example.invalid",
    scopes: fullScopes, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", tokenExpiresAt: timestamp,
    expectedConnectionUpdatedAt: timestamp, expectedAccessTokenCiphertext: "synthetic-expected-cipher" };
  for (const change of [{ providerAccountId: "other" }, { expectedConnectionUpdatedAt: "2026-10-04T13:00:00Z" },
    { scopes: [gmailScope, driveScope] }, { refreshToken: null }])
    await assert.rejects(connectionsApi.persistGoogleScopeUpgrade({ ...candidate, ...change }));
  connection = { ...current(), status: "disconnected" };
  await assert.rejects(connectionsApi.persistGoogleScopeUpgrade(candidate));
  connection = current(); principal = connectionId;
  await assert.rejects(connectionsApi.persistGoogleScopeUpgrade(candidate));
  assert.equal(calls.length, 0);
  principal = userId;
  await connectionsApi.persistGoogleScopeUpgrade(candidate);
  assert.equal(calls[0].name, "upgrade_google_connection_scopes");
  assert.ok(!JSON.stringify(calls[0].args).includes("synthetic-access"));
  assert.ok(!JSON.stringify(calls[0].args).includes("synthetic-refresh"));
  assert.equal(calls[0].args.p_expected_access_token_ciphertext, candidate.expectedAccessTokenCiphertext);
  assert.ok(!("p_gmail_history_id" in calls[0].args));
});
