"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function PromotionalToggle({ enabled, href }: { enabled: boolean; href: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useOptimistic(enabled);
  return <button type="button" role="switch" aria-checked={checked} aria-busy={pending} disabled={pending}
    className="inline-flex min-h-9 items-center gap-2 text-xs text-slate-600 disabled:cursor-wait"
    onClick={() => startTransition(() => { setChecked(!enabled); router.replace(href, { scroll: false }); })}>
    <span aria-hidden="true" className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors ${checked ? "border-blue-500 bg-blue-500" : "border-slate-300 bg-slate-200"}`}>
      <span className={`absolute top-px size-3 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-3" : "translate-x-px"}`}/>
    </span>
    광고 포함
    <span className="grid size-4 shrink-0 place-items-center">{pending && <Loader2 aria-hidden="true" className="size-3 animate-spin"/>}</span>
  </button>;
}
