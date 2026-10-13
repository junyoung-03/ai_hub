"use client";

import Link from "next/link";
import { ChevronDown, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";

export function HeaderMenus({ email }: { email: string }) {
  const pathname = usePathname();
  return <HeaderMenuContent key={pathname} email={email} />;
}

function HeaderMenuContent({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        profileButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const initial = email ? email[0].toUpperCase() : "U";
  const linkStyle =
    "flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <div ref={root} className="relative flex shrink-0 items-center">
      <button
        ref={profileButton}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="사용자 계정 메뉴"
        aria-expanded={open}
        aria-controls="header-profile-options"
        className="inline-flex min-h-9 items-center gap-2 rounded-full border border-slate-200/80 bg-white px-2 py-1 transition-colors hover:border-slate-300 hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-ring sm:px-2.5"
      >
        <span className="grid size-6 place-items-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
          {initial}
        </span>
        <span className="hidden text-xs font-normal text-slate-700 sm:inline max-w-[240px] truncate">
          {email || "사용자 계정"}
        </span>
        <ChevronDown className="size-3 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          id="header-profile-options"
          role="region"
          aria-label="계정 메뉴"
          className="absolute right-0 top-11 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200/80 bg-white p-2 shadow-lg z-50"
        >
          <div className="mb-1 border-b border-slate-100 px-3 py-2.5">
            <p className="text-[11px] text-slate-400">로그인 계정</p>
            <p className="mt-0.5 break-all text-xs font-medium text-slate-700">
              {email || "로그인된 계정"}
            </p>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className={linkStyle}
          >
            <Settings className="size-4" aria-hidden="true" />
            설정 · 연결 관리
          </Link>
          <div className="mt-1 border-t border-slate-100 px-2 pt-1 text-right">
            <LogoutButton />
          </div>
        </div>
      )}
    </div>
  );
}
