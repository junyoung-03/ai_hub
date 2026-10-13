import Link from "next/link";
import { HeaderMenus } from "@/components/shell/header-menus";
import { Navigation } from "@/components/shell/navigation";

export function TopBar({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/70 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1480px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6 md:gap-8">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-slate-900 transition-opacity hover:opacity-80"
            aria-label="etc. 홈"
          >
            <span className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
              <span className="text-blue-600 text-3xl font-bold">✦</span>
              <span>etc.</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center">
            <Navigation horizontal />
          </div>
        </div>
        <HeaderMenus email={email} />
      </div>
    </header>
  );
}
