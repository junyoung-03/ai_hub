import type { ReactNode } from "react";

export function PageHeading({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
    <div><h1 className="text-[30px] font-bold tracking-tight text-slate-900">{title}</h1><p className="mt-1 text-sm text-slate-500">{description}</p></div>
    {children}
  </div>;
}
