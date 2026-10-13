"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

function getRank(pathname: string): number {
  if (pathname === "/") return 0;
  if (pathname.startsWith("/library") || pathname.startsWith("/items")) return 1;
  if (pathname.startsWith("/actions")) return 2;
  if (pathname.startsWith("/settings")) return 3;
  return 1;
}

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);
  const [direction, setDirection] = useState<"right" | "left">("right");

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      const prevRank = getRank(prevPathRef.current);
      const currentRank = getRank(pathname);
      setDirection(currentRank >= prevRank ? "right" : "left");
      prevPathRef.current = pathname;
    }
  }, [pathname]);

  return (
    <div
      key={pathname}
      className={direction === "right" ? "animate-page-slide-right" : "animate-page-slide-left"}
    >
      {children}
    </div>
  );
}
