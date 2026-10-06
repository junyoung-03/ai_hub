"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setMessage(null);
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw new Error("Logout unavailable.");
      router.replace("/login");
      router.refresh();
    } catch {
      setPending(false);
      setMessage("로그아웃하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  return (
    <div className="shrink-0 text-right">
      <button type="button" onClick={signOut} disabled={pending} className="min-h-9 rounded-lg px-1.5 text-xs text-muted-foreground hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 sm:px-3 sm:text-sm">
        {pending ? "로그아웃 중…" : "로그아웃"}
      </button>
      {message && <p role="alert" className="mt-2 text-xs text-destructive">{message}</p>}
    </div>
  );
}
