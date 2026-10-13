import type { ReactNode } from "react";
import { Suspense } from "react";
import { Navigation } from "@/components/shell/navigation";
import { TopBar } from "@/components/shell/top-bar";
import { PageTransition } from "@/components/shell/page-transition";
import { getCurrentUser, requirePageUser } from "@/lib/supabase/auth";

export async function AppShell({
  title,
  children,
  hideTitle = false,
  demo = false,
  homeBackground = true,
  workspace = false,
}: {
  title: string;
  children: ReactNode;
  hideTitle?: boolean;
  demo?: boolean;
  homeBackground?: boolean;
  workspace?: boolean;
}) {
  const user = demo ? await getCurrentUser().catch(() => null) : await requirePageUser();
  const email = user?.email || "";

  return (
    <div className={`relative isolate min-h-dvh ${homeBackground ? "home-reference-shell bg-transparent" : "bg-[#f5f9ff]"} text-slate-800 antialiased ${hideTitle ? "home-shell" : ""} ${workspace ? "workspace-shell" : ""}`}>
      {homeBackground && (
        <><div className="home-background-ghost" aria-hidden="true" /><div className="home-background-wash" aria-hidden="true" /></>
      )}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3 focus:shadow-md"
      >
        본문으로 이동
      </a>
      <Suspense fallback={<div className="h-14 border-b border-slate-200/80 bg-white" />}>
        <TopBar email={email} />
      </Suspense>
      <main id="main-content" className="w-full pb-24 md:pb-12">
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10">
          {!hideTitle && (
            <h1 className="mb-6 break-words text-xl font-semibold tracking-[-0.025em] text-slate-900">
              {title}
            </h1>
          )}
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/95 backdrop-blur-sm px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
        <Navigation mobile />
      </div>
    </div>
  );
}
