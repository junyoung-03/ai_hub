"use client";

import Link from "next/link";
import { Plus, Upload, FileText, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";

export function HeaderMenus({ email }: { email: string }) {
  const pathname = usePathname();
  return <HeaderMenuContent key={pathname} email={email}/>;
}

function HeaderMenuContent({ email }: { email: string }) {
  const [open, setOpen] = useState<"add" | "profile" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(null); (open === "add" ? addButton : profileButton).current?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  const linkStyle = "flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-600 hover:bg-[#f1f5fd] focus-visible:outline-2 focus-visible:outline-[#7894bd]";
  return <div ref={root} className="relative flex shrink-0 items-center gap-3">
    <button ref={addButton} type="button" onClick={() => setOpen(open === "add" ? null : "add")} aria-expanded={open === "add"} aria-controls="header-add-options" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3 text-xs text-slate-600 hover:border-[#bdcee9] focus-visible:outline-2 focus-visible:outline-[#7894bd]"><Plus className="size-3.5" aria-hidden="true"/>자료 추가</button>
    <button ref={profileButton} type="button" onClick={() => setOpen(open === "profile" ? null : "profile")} aria-label="프로필 메뉴" aria-expanded={open === "profile"} aria-controls="header-profile-options" className="grid size-8 place-items-center rounded-full bg-[#e7eefb] text-xs font-medium text-[#6d88b0] ring-1 ring-[#d9e3f5] focus-visible:outline-2 focus-visible:outline-[#7894bd]">{email ? email[0].toUpperCase() : "U"}</button>
    {open === "add" && <div id="header-add-options" role="region" aria-label="자료 추가 방법" className="absolute right-0 top-12 w-60 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_12px_36px_-12px_rgba(64,87,128,0.22)]">
      <p className="px-3 pb-2 pt-1 text-[11px] text-slate-400">내 자료 추가</p>
      <Link href="/library#upload" onClick={() => setOpen(null)} className={linkStyle}><Upload className="size-4" aria-hidden="true"/>PDF·이미지 업로드</Link>
      <Link href="/library#manual-text" onClick={() => setOpen(null)} className={linkStyle}><FileText className="size-4" aria-hidden="true"/>직접 텍스트 입력</Link>
    </div>}
    {open === "profile" && <div id="header-profile-options" role="region" aria-label="계정 메뉴" className="absolute right-0 top-12 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_12px_36px_-12px_rgba(64,87,128,0.22)]">
      <div className="mb-1 border-b border-slate-100 px-3 py-3"><p className="text-[11px] text-slate-400">계정</p><p className="mt-1 break-all text-xs text-slate-600">{email || "로그인된 계정"}</p></div>
      <Link href="/settings" onClick={() => setOpen(null)} className={linkStyle}><Settings className="size-4" aria-hidden="true"/>설정 · 연결 관리</Link>
      <div className="mt-1 border-t border-slate-100 px-2 pt-1 text-right"><LogoutButton/></div>
    </div>}
  </div>;
}
