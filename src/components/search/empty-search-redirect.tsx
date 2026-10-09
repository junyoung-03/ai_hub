"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** One client transition avoids React dev profiling of a server redirect throw. */
export function EmptySearchRedirect() {
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    router.replace("/");
  }, [router]);

  return null;
}
