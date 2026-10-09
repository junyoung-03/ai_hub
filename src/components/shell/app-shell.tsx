import styles from "@/components/workspace/demo-frame.module.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Navigation } from "@/components/shell/navigation";
import { TopBar } from "@/components/shell/top-bar";
import { Sidebar } from "@/components/shell/sidebar";
import { requirePageUser } from "@/lib/supabase/auth";

export async function AppShell({ title, children, hideTitle = false, demo = true }: { title: string; children: ReactNode; hideTitle?: boolean; demo?: boolean }) {
  // Every protected page retains its server-side session boundary.
  const user = await requirePageUser();
  return <div className={demo ? `${styles.demo} min-h-dvh bg-[#fdfdfd] text-slate-800` : "min-h-dvh bg-canvas"} style={demo ? { backgroundImage:"radial-gradient(ellipse at 48% 8%, #f8f9fc 0%, transparent 48%), radial-gradient(ellipse at 90% 70%, #fcfcfe 0%, transparent 55%)" } : undefined}>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">본문으로 이동</a>
    <Suspense fallback={<div className="h-14 border-b bg-surface" />}><TopBar email={user.email ?? ""} /></Suspense>
    <div className="flex">
      <Sidebar demo={demo}/>
      <main id="main-content" className="min-w-0 flex-1 px-4 py-6 pb-28 md:px-8 md:py-8 md:pb-12">
        <div className={demo ? "mx-auto max-w-[1100px]" : "mx-auto max-w-5xl"}>{!hideTitle && <h1 className="mb-6 break-words text-xl font-medium tracking-[-0.025em]">{title}</h1>}{children}</div>
      </main>
    </div>
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom)] md:hidden"><Navigation mobile /></div>
  </div>;
}
