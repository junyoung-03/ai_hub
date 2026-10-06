import type { ReactNode } from "react";
import Link from "next/link";
import { Suspense } from "react";
import { Navigation } from "@/components/shell/navigation";
import { TopBar } from "@/components/shell/top-bar";
import { requirePageUser } from "@/lib/supabase/auth";

export async function AppShell({ title, children, hideTitle = false }: { title: string; children: ReactNode; hideTitle?: boolean }) {
  // Every protected page retains its server-side session boundary.
  await requirePageUser();
  return <div className="min-h-dvh bg-canvas">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">본문으로 이동</a>
    <Suspense fallback={<div className="h-14 border-b bg-surface" />}><TopBar /></Suspense>
    <div className="flex">
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-52 shrink-0 flex-col justify-between border-r border-line bg-surface px-3 py-6 md:flex">
        <Navigation />
        <Link href="/settings" className="rounded-xl bg-canvas p-3 text-sm text-muted-foreground"><span className="mb-1 block text-xs font-medium text-faint">COLLECT · FIND · ACT</span>Google 연결 관리 →</Link>
      </aside>
      <main id="main-content" className="min-w-0 flex-1 px-4 py-6 pb-28 md:px-8 md:py-8 md:pb-12">
        <div className="mx-auto max-w-5xl">{!hideTitle && <h1 className="mb-6 break-words text-xl font-medium tracking-[-0.025em]">{title}</h1>}{children}</div>
      </main>
    </div>
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom)] md:hidden"><Navigation mobile /></div>
  </div>;
}
