"use client";

import { House, Library, ListChecks, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "오늘", icon: House },
  { href: "/library", label: "자료함", icon: Library },
  { href: "/actions", label: "플래너", icon: ListChecks },
  { href: "/settings", label: "설정", icon: Settings },
];

export function Navigation({
  mobile = false,
  horizontal = false,
  collapsed = false,
}: {
  mobile?: boolean;
  horizontal?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  if (mobile) {
    return (
      <nav aria-label="모바일 주요 메뉴" className="grid grid-cols-4">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href === "/" && pathname === "/search") ||
            (href === "/library" && pathname.startsWith("/items/"));
          return (
            <Link
              key={href}
              href={href}
              prefetch={true}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[12px] text-slate-500 hover:text-slate-900",
                active && "font-semibold text-slate-900"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  // Desktop horizontal top nav or vertical fallback
  return (
    <nav
      aria-label="주요 메뉴"
      className={horizontal ? "flex items-center gap-1 md:gap-1.5" : "space-y-1.5"}
    >
      {links.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href ||
          (href === "/" && pathname === "/search") ||
          (href === "/library" && pathname.startsWith("/items/"));
        return (
          <Link
            key={href}
            href={href}
            prefetch={true}
            aria-current={active ? "page" : undefined}
            title={collapsed && !horizontal ? label : undefined}
            className={cn(
              "inline-flex items-center rounded-lg text-sm font-normal text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-ring",
              horizontal
                ? "px-5 py-2 text-sm"
                : collapsed
                ? "h-9 justify-center"
                : "h-9 gap-2.5 px-3",
              active && "bg-blue-50 font-semibold text-blue-600"
            )}
          >
            {!horizontal && <Icon className="size-4 shrink-0" aria-hidden="true" />}
            <span className={collapsed && !horizontal ? "sr-only" : undefined}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
