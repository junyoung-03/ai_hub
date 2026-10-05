import Link from "next/link";
import { Search, ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { SearchWorkspace } from "@/components/search/search-workspace";
import { ItemMetadata } from "@/components/items/item-summary";
import { listItems } from "@/lib/items/queries";
import { parseItemQuery } from "@/lib/items/filters";
import { requirePageUser } from "@/lib/supabase/auth";

export default async function Page() {
  await requirePageUser();
  const recent = await listItems(parseItemQuery(new URLSearchParams("limit=6"))).catch(() => null);
  return <AppShell title="오늘, 놓치지 않도록">
    <section className="panel mb-9 border-primary/20"><p className="mb-3 text-sm font-medium text-primary">내 정보의 시작점</p><h2 className="mb-5">필요한 정보, 기억나는 말로 찾으세요.</h2><form action="/search" className="flex flex-wrap items-center gap-3"><Search className="size-6 text-primary" aria-hidden="true"/><label className="min-w-0 flex-1"><span className="sr-only">통합 검색어</span><input name="q" required maxLength={500} className="field min-h-14 text-base" placeholder="예: 이번 주 제출" /></label><button className="btn-primary">검색하기</button></form><p className="meta mt-3">메일 · 문서 · 일정 · 업로드 자료를 함께 검색합니다.</p></section>
    <section className="mb-10"><div className="mb-5 flex items-center justify-between gap-3"><h2>먼저 확인할 할 일</h2><Link href="/actions" className="text-sm text-primary">전체 보기 →</Link></div><SearchWorkspace initialQuery="해야 할 일" actions today /></section>
    <section><div className="mb-5 flex items-center justify-between"><h2>최근 모인 자료</h2><Link href="/library" className="text-sm text-primary">자료 전체 →</Link></div>{recent ? recent.items.length ? <div className="grid gap-4 xl:grid-cols-2">{recent.items.map(item=><article key={item.id} className="panel"><Link href={`/items/${item.id}`} className="mb-3 flex items-start justify-between gap-3 font-semibold"><span className="break-words">{item.title}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/></Link><ItemMetadata item={item}/></article>)}</div> : <div className="panel"><h3>아직 모인 자료가 없어요</h3><p className="mt-2 text-muted-foreground">Google을 연결하거나 PDF·이미지를 올려 시작하세요.</p><Link href="/settings" className="btn-secondary mt-4">Google 연결</Link><Link href="/library#upload" className="btn-primary ml-3 mt-4">자료 추가</Link></div> : <div role="alert" className="panel">최근 자료를 불러오지 못했습니다. <Link href="/" className="underline">다시 불러오기</Link></div>}</section>
  </AppShell>;
}
