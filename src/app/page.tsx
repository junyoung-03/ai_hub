import Link from "next/link";
import { Search } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { HomeActions } from "@/components/items/home-actions";
import { ItemCard } from "@/components/items/item-summary";
import { listItems } from "@/lib/items/queries";
import { parseItemQuery } from "@/lib/items/filters";
import { requirePageUser } from "@/lib/supabase/auth";

export default async function Page() {
  await requirePageUser();
  const recent = await listItems(parseItemQuery(new URLSearchParams("limit=6"))).catch(() => null);
  return <AppShell title="오늘, 놓치지 않도록" hideTitle>
    <section className="mb-8">
      <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em]">흩어진 정보에서, 지금 필요한 것만.</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">자료를 찾고, 해야 할 일과 그 근거를 함께 확인하세요.</p>
      <form action="/search" className="mt-5 flex items-center gap-3 border-b border-line pb-3"><Search className="size-5 shrink-0 text-faint" aria-hidden="true"/><label className="min-w-0 flex-1"><span className="sr-only">통합 검색어</span><input name="q" required maxLength={500} className="min-h-11 w-full bg-transparent text-base outline-none placeholder:text-faint sm:text-lg" placeholder="예: 이번 주 제출할 자료" /></label><button className="btn-primary">검색</button></form>
      <div className="mt-4 flex flex-wrap gap-1.5">{[["gmail","메일"],["drive","드라이브"],["calendar","캘린더"],["upload","직접 올림"]].map(([source,label])=><Link key={source} href={`/library?source=${source}`} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted-foreground hover:text-ink">{label}</Link>)}</div>
    </section>    <div className="mb-10"><HomeActions /></div>
    <section><div className="mb-5 flex items-center justify-between"><h2>최근 모인 자료</h2><Link href="/library" className="text-sm text-primary">자료 전체 →</Link></div>{recent ? recent.items.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{recent.items.map(item=><ItemCard key={item.id} item={item} tile />)}</div> : <div className="panel"><h3>아직 모인 자료가 없어요</h3><p className="mt-2 text-muted-foreground">Google을 연결하거나 PDF·이미지를 올려 시작하세요.</p><Link href="/settings" className="btn-secondary mt-4">Google 연결</Link><Link href="/library#upload" className="btn-primary ml-3 mt-4">자료 추가</Link></div> : <div role="alert" className="panel">최근 자료를 불러오지 못했습니다. <Link href="/" className="underline">다시 불러오기</Link></div>}</section>
  </AppShell>;
}
