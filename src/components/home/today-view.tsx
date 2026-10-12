import { promotionalReady } from "@/lib/items/promotional-gate";
import { getWorkspaceClock } from "@/components/workspace/request-clock";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { ScheduleWorkspace } from "@/components/actions/schedule-workspace";
import { dayInSeoul } from "@/components/actions/schedule-model";
import { SourceBadge, workspaceSources } from "@/components/workspace/workspace-ui";
import { listItems } from "@/lib/items/queries";
import { parseItemQuery } from "@/lib/items/filters";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getGoogleConnectionSummary } from "@/lib/google/connections";
import { formatRelativeTime, formatLabels } from "@/lib/items/presentation";

export async function TodayView({ includePromotional = false }: { includePromotional?: boolean } = {}) {
  const promotionalEnabled = await promotionalReady();
  includePromotional = promotionalEnabled && includePromotional;
  const user = await getCurrentUser().catch(() => null);
  const [recent, connection] = await Promise.all([
    listItems(parseItemQuery(new URLSearchParams(`limit=3${includePromotional ? "&includePromotional=true" : ""}`))).catch(() => null),
    user ? getGoogleConnectionSummary(user.id).catch(() => null) : Promise.resolve(null),
  ]);
  const now=await getWorkspaceClock();
  return <AppShell title="홈" hideTitle demo>
    <section className="mx-auto mb-10 max-w-3xl pb-3 pt-4 text-center sm:mb-12 sm:pt-9">
      {connection?.status==="connected"&&<p className="mb-6 text-[11px] text-slate-400"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500"/>Google 연결됨 {connection.lastSyncedAt?`· ${formatRelativeTime(connection.lastSyncedAt)}`:""}<Link href="/settings" className="ml-2 hover:text-[#6b88b3]">연결 관리 ↗</Link></p>}
      <h1 className="text-[30px] font-semibold leading-[1.4] tracking-[-0.035em] text-slate-900 sm:text-[40px]">내 정보에서<br/>무엇이든 찾아보세요</h1>
      <p className="mt-3 text-sm text-slate-400">메일, 문서, 일정과 메모를 한곳에서.</p>
      <form action="/search" className="mx-auto mt-7 flex min-h-14 max-w-2xl items-center gap-3 rounded-full border border-slate-200/70 bg-white px-4 shadow-[0_6px_25px_rgba(72,100,145,0.05)] sm:min-h-16 sm:px-5">
        <Search className="size-5 shrink-0 text-[#8ba0bf]" aria-hidden="true"/><label className="min-w-0 flex-1 text-left"><span className="sr-only">내 자료 통합 검색어</span><input name="q" required maxLength={500} placeholder="내 자료에서 무엇이든 찾아보세요" className="min-h-12 w-full bg-transparent text-sm outline-none placeholder:text-slate-400 sm:text-base"/></label><button aria-label="자료 검색" className="grid size-9 shrink-0 place-items-center rounded-full bg-[#7894bd] text-white transition-colors hover:bg-[#5c7ca9]"><ArrowRight className="size-5"/></button>
      </form>
      <div className="mt-5 flex flex-wrap justify-center gap-2">{workspaceSources.map(({value,label,Icon,color})=><Link key={value} href={value==="upload"?"/library#upload":value==="manual"?"/library#manual-text":`/library?source=${value}`} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200/70 bg-white/85 px-4 text-xs text-slate-600 transition-colors hover:border-[#c5d4eb]"><Icon className={`size-4 ${color}`} aria-hidden="true"/>{label}</Link>)}</div>
    </section>
    <ScheduleWorkspace today={dayInSeoul(now)} now={now} home/>
    <section className="mt-10">{promotionalEnabled && <Link href={includePromotional ? "/" : "/?includePromotional=true"} role="switch" aria-checked={includePromotional} className="mb-3 inline-flex min-h-9 items-center text-xs text-slate-600">광고 포함 {includePromotional ? "켜짐" : "꺼짐"}</Link>}<div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-800">최근 추가된 자료</h2><p className="mt-1 text-xs text-slate-400">새로 모인 정보부터 가볍게 살펴보세요.</p></div><Link href="/library" className="inline-flex items-center gap-1 text-xs text-[#6d88b0]">자료 전체<ArrowRight className="size-3.5"/></Link></div>
      {recent?recent.items.length?<ul className="grid gap-3 sm:grid-cols-3">{recent.items.map(item=><li key={item.id}><Link href={`/items/${item.id}`} className="flex h-full min-w-0 flex-col rounded-2xl border border-slate-200/70 bg-white/85 p-4 transition-colors hover:border-[#c5d4eb]"><SourceBadge source={item.source}/><h3 className="mt-3 line-clamp-2 break-words text-sm font-semibold leading-6 text-slate-700">{item.title}</h3><p className="mt-1 text-xs text-slate-400">{item.classification.primaryTopic??formatLabels[item.format]}</p><p className="mt-auto pt-3 text-[11px] text-slate-400">{formatRelativeTime(item.createdAt)}</p></Link></li>)}</ul>:<p className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 text-sm text-slate-400">아직 자료가 없습니다. Google을 연결하거나 파일·메모를 추가해 주세요.</p>:<p role="alert" className="text-sm text-red-500">최근 자료를 불러오지 못했습니다. <Link href="/" className="underline">다시 불러오기</Link></p>}
    </section>
  </AppShell>;
}
