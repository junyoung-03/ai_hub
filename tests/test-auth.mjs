// Isolated contract tests: no network, credentials, or real login sessions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");

function load(path, dependencies, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports, URL, Headers, ...globals,
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (["next/server", "react/jsx-runtime"].includes(name)) return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

function callbackClient({ exchangeError = null, userError = null, profile = { id: "test-user" }, profileError = null } = {}) {
  const calls = [];
  const client = {
    auth: {
      async exchangeCodeForSession(code) { calls.push(["exchange", code]); return { error: exchangeError }; },
      async getUser() { return { data: { user: { id: "test-user" } }, error: userError }; },
      async signOut(options) { calls.push(["signOut", options]); return { error: null }; },
    },
    from(table) {
      calls.push(["table", table]);
      return { select(columns) {
        calls.push(["select", columns]);
        return { eq(column, value) {
          calls.push(["eq", column, value]);
          return { async maybeSingle() { return { data: profile, error: profileError }; } };
        } };
      } };
    },
  };
  const route = load("src/app/auth/callback/route.ts", {
    "@/lib/supabase/server": { async createClient() { return client; } },
  });
  return { route, calls };
}

test("callback rejects missing/duplicate/error codes without exchanging or reflecting input", async () => {
  const { route, calls } = callbackClient();
  for (const query of ["", "?code=", "?code=a&code=b", "?error=denied&error_description=private&code=a"]) {
    const response = await route.GET(new NextRequest(`http://localhost:3000/auth/callback${query}`));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/login?error=auth_callback");
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.deepEqual(calls, []);
});

test("successful callback ignores external redirects and reads only the user's profile ID", async () => {
  const { route, calls } = callbackClient();
  const response = await route.GET(new NextRequest("http://untrusted.example/auth/callback?code=test-code&next=https://evil.example", {
    headers: { "x-forwarded-host": "evil.example" },
  }));
  assert.equal(response.headers.get("location"), "/");
  assert.deepEqual(calls, [["exchange", "test-code"], ["table", "users"], ["select", "id"], ["eq", "id", "test-user"]]);
});

test("callback exchange/user failures stay on the safe login path", async () => {
  for (const options of [{ exchangeError: { message: "private" } }, { userError: { message: "private" } }]) {
    const { route } = callbackClient(options);
    const response = await route.GET(new NextRequest("http://localhost/auth/callback?code=test"));
    assert.equal(response.headers.get("location"), "/login?error=auth_callback");
  }
});

test("missing or inaccessible public.users profile signs out without creating data", async () => {
  for (const options of [{ profile: null }, { profileError: { message: "private" } }]) {
    const { route, calls } = callbackClient(options);
    const response = await route.GET(new NextRequest("http://localhost/auth/callback?code=test"));
    assert.equal(response.headers.get("location"), "/login?error=profile_setup");
    assert.equal(calls.at(-1)[0], "signOut");
    assert.equal(calls.at(-1)[1].scope, "local");
  }
});

test("server guard verifies getUser, redirects missing sessions, and fails closed on outages", async () => {
  for (const result of [
    { data: { user: null }, error: null },
    { data: { user: null }, error: { missing: true } },
    { data: { user: null }, error: { api: true, status: 401 } },
    { data: { user: { id: "verified" } }, error: null },
    { data: { user: null }, error: { message: "private outage" } },
  ]) {
    const auth = load("src/lib/supabase/auth.ts", {
      "server-only": {},
      "react": { cache: (fn) => fn },
      "@supabase/supabase-js": {
        isAuthSessionMissingError: (error) => error.missing,
        isAuthApiError: (error) => error.api,
      },
      "next/navigation": { redirect(path) { throw new Error(`redirect:${path}`); } },
      "@/lib/supabase/server": { async createClient() { return { auth: { async getUser() { return result; } } }; } },
    });
    if (result.data.user) assert.equal((await auth.requirePageUser()).id, "verified");
    else if (result.error?.message) await assert.rejects(auth.requirePageUser(), /Unable to verify/);
    else await assert.rejects(auth.requirePageUser(), /redirect:\/login/);
  }
});

test("proxy protects all specified routes and preserves refreshed cookies/cache headers", async () => {
  for (const signedIn of [false, true]) {
    const proxy = load("src/lib/supabase/proxy.ts", {
      "server-only": {},
      "@/lib/supabase/env": { isSupabaseConfigured: () => true, getSupabaseConfig: () => ({ url: "https://example.invalid", publishableKey: "test" }) },
      "@supabase/ssr": { createServerClient(_url, _key, { cookies }) {
        return { auth: { async getClaims() {
          cookies.setAll([{ name: "test-session", value: "first", options: { path: "/" } }], { "Cache-Control": "private, no-store", Expires: "0" });
          cookies.setAll([{ name: "test-session", value: "refreshed", options: { path: "/" } }], {});
          return { data: { claims: signedIn ? { sub: "test-user" } : null }, error: null };
        } } };
      } },
    });
    for (const path of ["/", "/landing", "/library", "/search", "/actions", "/settings", "/library/nested", "/login", "/auth/callback", "/library-public"]) {
      const request = new NextRequest(`http://localhost${path}`);
      const response = await proxy.updateSession(request);
      const isProtected = ["/library", "/search", "/actions", "/settings", "/library/nested"].includes(path);
      assert.equal(response.headers.get("location"), !signedIn && isProtected ? "http://localhost/login" : null);
      assert.equal(response.cookies.get("test-session").value, "refreshed");
      assert.equal(request.cookies.get("test-session").value, "refreshed");
      assert.equal(response.headers.get("expires"), "0");
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  }
});

function button(path, name, auth, navigation = {}, googleEnabled = true, states = []) {
  const component = load(path, {
    "react": { useState: (initial) => [initial, (value) => states.push(value)] },
    "next/navigation": { useRouter: () => navigation },
    "@/lib/supabase/client": { createClient: () => ({ auth }) },
    "@/lib/supabase/env": { getSupabaseConfig: () => ({ url: "https://example.invalid", publishableKey: "test" }) },
  }, {
    window: { location: { origin: "http://localhost:3000" } },
    AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ external: { google: googleEnabled } }) }),
  });
  return component[name]().props.children[0].props;
}

test("login requests account selection, identity scopes and the local callback", async () => {
  let options;
  const props = button("src/components/auth/google-sign-in-button.tsx", "GoogleSignInButton", {
    async signInWithOAuth(input) { options = input; return { data: { url: "https://example.invalid" }, error: null }; },
  });
  await props.onClick();
  assert.equal(options.provider, "google");
  assert.equal(options.options.scopes, "openid email profile");
  assert.equal(options.options.redirectTo, "http://localhost:3000/auth/callback");
  assert.equal(options.options.queryParams.prompt, "select_account");
});

test("logout redirects and refreshes only after local signOut succeeds", async () => {
  for (const failed of [false, true]) {
    const calls = [];
    const props = button("src/components/auth/logout-button.tsx", "LogoutButton", {
      async signOut(options) { calls.push(["signOut", options.scope]); return { error: failed ? { message: "private" } : null }; },
    }, { replace: (path) => calls.push(["replace", path]), refresh: () => calls.push(["refresh"]) });
    await props.onClick();
    assert.deepEqual(calls, failed ? [["signOut", "local"]] : [["signOut", "local"], ["replace", "/login"], ["refresh"]]);
  }
});

test("disabled Google provider stays on login and shows a safe message", async () => {
  const states = [];
  const props = button("src/components/auth/google-sign-in-button.tsx", "GoogleSignInButton", {
    async signInWithOAuth() { assert.fail("Disabled provider must not start OAuth"); },
  }, {}, false, states);
  await props.onClick();
  assert.ok(states.includes("Google 로그인 설정이 준비되지 않았습니다. 관리자에게 문의해 주세요."));
  assert.equal(states.at(-1), false);
});
