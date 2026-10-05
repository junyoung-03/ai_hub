import type { ReactNode } from "react";
import Link from "next/link";
import { Layers3, Plus, Search } from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";
import { Navigation } from "@/components/shell/navigation";
import { requirePageUser } from "@/lib/supabase/auth";

export async function AppShell({ title, children }: { title: string; children: ReactNode }) {
  // This server boundary runs for every protected page, independently of Proxy.
  const user = await requirePageUser();
  const label = user.email ?? "로그인 사용자";

  return (
    <div className="min-h-dvh bg-background md:pl-56">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:p-3">본문으로 이동</a>
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r bg-card px-4 py-8 md:block">
        <Link href="/" className="mb-2 flex items-center gap-3 px-3 text-xl font-semibold"><Layers3 className="size-7 shrink-0 text-primary" aria-hidden="true" />Hub</Link>
        <p className="mb-2 px-3 text-sm text-muted-foreground">AI 통합 정보 허브</p>
        <p className="mb-10 px-3 text-sm text-muted-foreground">COLLECT · FIND · ACT</p>
        <Navigation />
      </aside>
      <header className="flex min-h-20 items-center justify-between gap-3 border-b bg-card px-4 py-3 md:px-10">
        <div className="min-w-0">
          <Link href="/" className="font-semibold text-primary md:hidden">Hub</Link>
          <p className="truncate text-sm text-muted-foreground" title={label}>{label}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3"><Link href="/search" aria-label="통합 검색" className="p-2 text-muted-foreground"><Search className="size-5" /></Link><Link href="/library#upload" className="btn-primary"><Plus className="size-4" aria-hidden="true" />자료 추가</Link><LogoutButton /></div>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl px-5 py-8 pb-28 md:px-10 md:py-10 md:pb-12">
        <h1 className="mb-8 break-words text-[28px] font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
      <div className="fixed inset-x-0 bottom-0 border-t bg-background px-2 pb-[env(safe-area-inset-bottom)] md:hidden"><Navigation mobile /></div>
    </div>
  );
}
