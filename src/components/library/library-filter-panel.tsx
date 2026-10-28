"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function LibraryFilterPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const close = () => { if (panel.current) panel.current.open = false; };
    close();
    // Browser history can restore the existing DOM instead of mounting it again.
    window.addEventListener("pageshow", close);
    return () => { close(); window.removeEventListener("pageshow", close); };
  }, [pathname]);

  return <details ref={panel}>
    <summary className="w-fit cursor-pointer rounded-lg px-1 py-2 text-xs text-slate-500">분류 · 상세 필터{active ? " · 적용 중" : ""}</summary>
    {children}
  </details>;
}
