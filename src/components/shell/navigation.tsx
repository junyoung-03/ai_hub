"use client";

import { House, Library, Search, ListChecks, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "오늘", icon: House },
  { href: "/library", label: "자료", icon: Library },
  { href: "/search", label: "검색", icon: Search },
  { href: "/actions", label: "할 일", icon: ListChecks },
  { href: "/settings", label: "설정", icon: Settings },
];

export function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={mobile ? "모바일 주요 메뉴" : "주요 메뉴"} className={mobile ? "grid grid-cols-5" : "space-y-1"}>
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href === "/library" && pathname.startsWith("/items/"));
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}
          className={cn("flex items-center rounded-lg text-muted-foreground hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-ring", mobile ? "min-h-14 flex-col justify-center gap-1 py-2 text-[13px]" : "h-9 gap-2.5 px-3 text-sm", active && "bg-canvas font-medium text-ink")}>
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {label}
        </Link>
        })}
    </nav>
  );
}
