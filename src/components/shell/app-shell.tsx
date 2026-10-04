import type { ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { Navigation } from "@/components/shell/navigation";
import { requirePageUser } from "@/lib/supabase/auth";

export async function AppShell({ title, children }: { title: string; children: ReactNode }) {
  // This server boundary runs for every protected page, independently of Proxy.
  const user = await requirePageUser();
  const label = user.email ?? "로그인 사용자";

  return (
    <div className="min-h-dvh bg-muted/20 md:pl-60">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:p-3">본문으로 이동</a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r bg-background p-5 md:block">
        <p className="mb-2 font-semibold">AI 통합 정보 허브</p>
        <p className="mb-8 text-xs tracking-wider text-muted-foreground">COLLECT · FIND · ACT</p>
        <Navigation />
      </aside>
      <header className="flex min-h-20 items-center justify-between gap-4 border-b bg-background px-4 py-3 md:px-8">
        <div className="min-w-0">
          <p className="text-sm font-medium md:hidden">AI 통합 정보 허브</p>
          <p className="truncate text-sm text-muted-foreground" title={label}>{label}</p>
        </div>
        <LogoutButton />
      </header>
      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8 pb-28 md:px-8 md:pb-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
        <section className="rounded-xl border bg-card p-6 text-card-foreground">{children}</section>
      </main>
      <div className="fixed inset-x-0 bottom-0 border-t bg-background px-2 pb-[env(safe-area-inset-bottom)] md:hidden"><Navigation mobile /></div>
    </div>
  );
}
