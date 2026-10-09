"use client";

import { useEffect } from "react";

/** Opens the existing input controls selected by a navigation fragment. */
export function MaterialFocus() {
  useEffect(() => {
    const openById = (id: string) => {
      if (id !== "upload" && id !== "manual-text") return;
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement) {
        target.open = true;
        target.scrollIntoView({ block: "start" });
      }
    };
    const openTarget = () => openById(window.location.hash.slice(1));
    // Next's same-page fragment navigation uses history state, so it may not fire hashchange.
    const onLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const href = new URL(anchor.href);
      if (href.origin === window.location.origin && href.pathname === window.location.pathname) openById(href.hash.slice(1));
    };
    openTarget();
    window.addEventListener("hashchange", openTarget);
    document.addEventListener("click", onLink, true);
    return () => { window.removeEventListener("hashchange", openTarget); document.removeEventListener("click", onLink, true); };
  }, []);
  return null;
}
