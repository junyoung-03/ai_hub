"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/env";

export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setMessage(null);
    try {
      // Settings are public. Avoid sending users to a raw Auth error page when
      // the provider is not configured; never display the settings response.
      const { url, publishableKey } = getSupabaseConfig();
      const response = await fetch(new URL("/auth/v1/settings", url), {
        headers: { apikey: publishableKey },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Login unavailable.");
      const settings: { external?: { google?: boolean } } = await response.json();
      if (settings?.external?.google !== true) {
        setMessage("Google 로그인 설정이 준비되지 않았습니다. 관리자에게 문의해 주세요.");
        setPending(false);
        return;
      }
      const { data, error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: new URL("/auth/callback", window.location.origin).href,
          scopes: "openid email profile",
        },
      });
      if (error || !data.url) throw new Error("Login unavailable.");
    } catch {
      setMessage("Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={signIn} disabled={pending} className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
        {pending ? "Google 로그인으로 이동 중…" : "Google로 로그인"}
      </button>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    </div>
  );
}
