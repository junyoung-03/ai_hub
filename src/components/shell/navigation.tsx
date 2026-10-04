"use client";

import { House, Library, Search, ListChecks, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home", icon: House },
  { href: "/library", label: "Library", icon: Library },
  { href: "/search", label: "Search", icon: Search },
  { href: "/actions", label: "Actions", icon: ListChecks },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={mobile ? "모바일 주요 메뉴" : "주요 메뉴"} className={mobile ? "grid grid-cols-5" : "space-y-1"}>
      {links.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}
          className={cn("flex min-h-12 items-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring", mobile ? "flex-col justify-center gap-1 py-2 text-[11px]" : "gap-3 px-3 text-sm", pathname === href && "bg-accent font-medium text-accent-foreground")}>
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
