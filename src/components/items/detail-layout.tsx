"use client";
import { useState, type ReactNode } from "react";

/** One reading pane at a time at every screen size. */
export function DetailLayout({ original, insight }: { original: ReactNode; insight: ReactNode }) {
  const [active, setActive] = useState<"original" | "insight">("original");
  return <>
    <div className="sticky top-14 z-20 mt-6 grid grid-cols-2 border-b border-line bg-canvas" role="tablist" aria-label="자료 상세 영역">
      {([['original', '원문'], ['insight', 'AI 분석 · 할 일']] as const).map(([id, label]) =>
        <button key={id} id={`${id}-tab`} type="button" role="tab" aria-selected={active === id} aria-controls={`${id}-pane`} tabIndex={active === id ? 0 : -1}
          className={`min-h-11 border-b-2 px-3 py-3 text-sm ${active === id ? "border-ink font-medium text-ink" : "border-transparent text-muted-foreground"}`}
          onClick={() => setActive(id)} onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next = event.key === "Home" ? "original" : event.key === "End" ? "insight" : active === "original" ? "insight" : "original";
              setActive(next); document.getElementById(`${next}-tab`)?.focus();
            }
          }}>{label}</button>)}
    </div>
    <div className="mt-6">
      <div id="original-pane" role="tabpanel" aria-labelledby="original-tab" tabIndex={0} hidden={active !== "original"} className="min-w-0">{original}</div>
      <div id="insight-pane" role="tabpanel" aria-labelledby="insight-tab" tabIndex={0} hidden={active !== "insight"} className="min-w-0">{insight}</div>
    </div>
  </>;
}
