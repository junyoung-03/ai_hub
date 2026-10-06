"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, Upload } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";

export function TopBar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  return <TopBarContent key={`${pathname}:${query}`} initialQuery={pathname === "/search" ? query : ""} />;
}

function TopBarContent({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  return <header className="sticky top-0 z-30 border-b border-line bg-surface">
    <div className="flex h-14 items-center gap-2 px-4 sm:gap-4 md:px-6">
      <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Hub 홈">
        <span className="grid size-8 place-items-center rounded-xl bg-ink text-xs font-semibold tracking-[0.08em] text-white">H</span>
        <span className="hidden text-[15px] font-semibold tracking-[0.12em] sm:inline">HUB</span>
        <span className="hidden text-xs text-muted-foreground xl:inline">AI 통합 정보 허브</span>
      </Link>
      <form role="search" className="min-w-0 flex-1" onSubmit={event => { event.preventDefault(); const next=value.trim(); router.push(next ? `/search?q=${encodeURIComponent(next)}` : "/search"); }}>
        <div className="relative mx-auto max-w-xl">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input aria-label="통합 검색" value={value} onChange={event=>setValue(event.target.value)} maxLength={500} placeholder="자료·할 일·마감일을 검색" className="h-9 w-full rounded-xl border border-transparent bg-canvas pl-9 pr-3 text-sm outline-none placeholder:text-faint focus:border-line focus:bg-surface" />
        </div>
      </form>
      <Link href="/library#upload" aria-label="자료 올리기" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ink px-2.5 text-sm font-medium hover:bg-ink hover:text-white sm:px-3.5"><Upload className="size-4" aria-hidden="true" /><span className="hidden sm:inline">올리기</span></Link>
      <LogoutButton />
    </div>
  </header>;
}
