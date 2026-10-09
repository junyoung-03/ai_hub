import { Mail, Files, CalendarDays, Upload, FileText } from "lucide-react";
export const workspaceSources = [
  {value:"gmail",label:"Gmail",Icon:Mail,color:"text-[#cc5353]",bg:"bg-[#fff0ef]"},
  {value:"drive",label:"Drive",Icon:Files,color:"text-[#4b8b73]",bg:"bg-[#ecf7f1]"},
  {value:"calendar",label:"Calendar",Icon:CalendarDays,color:"text-[#527cbd]",bg:"bg-[#edf3ff]"},
  {value:"upload",label:"업로드",Icon:Upload,color:"text-[#8b72a7]",bg:"bg-[#f5effb]"},
  {value:"manual",label:"직접입력",Icon:FileText,color:"text-[#66758d]",bg:"bg-[#f0f3f8]"},
];
export function SourceBadge({source,iconOnly=false}:{source:string;iconOnly?:boolean}) {
  const match=workspaceSources.find(entry=>entry.value===source);
  if(!match)return <span className="text-xs text-slate-500">{source}</span>;
  const {Icon,label,color,bg}=match;
  return <span className={`inline-flex shrink-0 self-start items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${color} ${bg}`} title={label}><Icon className="size-3.5" aria-hidden="true"/>{!iconOnly&&label}<span className="sr-only">{iconOnly?label:""}</span></span>;
}
export function WorkspaceSkeleton({rows=3}:{rows?:number}) {
  return <div role="status" aria-label="자료를 불러오는 중" className="space-y-3 py-4">{Array.from({length:rows},(_,index)=><div key={index} className="flex gap-3 rounded-xl border border-slate-100 bg-white/80 p-4"><div className="size-9 shrink-0 rounded-lg bg-slate-100 motion-safe:animate-pulse"/><div className="min-w-0 flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-slate-100 motion-safe:animate-pulse"/><div className="h-2.5 w-1/2 rounded bg-slate-50 motion-safe:animate-pulse"/></div></div>)}<span className="sr-only">불러오는 중</span></div>;
}
