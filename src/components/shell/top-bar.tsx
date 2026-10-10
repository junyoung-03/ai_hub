import Link from "next/link";
import { HeaderMenus } from "@/components/shell/header-menus";

export function TopBar({ email }: { email: string }) {
  return <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90">
    <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
      <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="etc. 홈">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#7894bd] text-[11px] font-semibold text-white">e</span>
        <span className="text-sm font-semibold tracking-[0.08em] text-slate-800">etc.</span>
        <span className="hidden text-[11px] text-slate-400 sm:inline">COLLECT · FIND · ACT</span>
      </Link>
      <HeaderMenus email={email}/>
    </div>
  </header>;
}
