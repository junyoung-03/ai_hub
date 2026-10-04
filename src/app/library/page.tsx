import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { ClassificationSummary, ItemMetadata } from "@/components/items/item-summary";
import { LibraryFilters } from "@/components/items/library-filters";
import { requirePageUser } from "@/lib/supabase/auth";
import { InvalidItemQueryError, libraryUrl, parseItemQuery } from "@/lib/items/filters";
import { listItems, type ItemList } from "@/lib/items/queries";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.set(key, value);
  }
  let query;
  try { query = parseItemQuery(params); }
  catch (error) {
    if (!(error instanceof InvalidItemQueryError)) throw error;
    return <AppShell title="Library"><div role="alert" className="space-y-3"><p>{error.message}</p><Link href="/library" className="text-sm underline">필터 초기화</Link></div></AppShell>;
  }
  let result: ItemList | null = null;
  try { result = await listItems(query); }
  catch { /* Keep raw Auth/DB errors out of UI and logs. */ }
  return (
    <AppShell title="Library">
      <LibraryFilters query={query} />
      {!result ? <div role="alert" className="space-y-3"><p>자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p><a href={libraryUrl(query)} className="text-sm underline">다시 불러오기</a></div>
        : <>
          {result.items.length ? <ul className="divide-y">{result.items.map((item) => <li key={item.id} className="space-y-3 py-5 first:pt-0"><Link href={`/items/${item.id}`} className="block break-words text-lg font-medium underline-offset-4 hover:underline">{item.title}</Link><ItemMetadata item={item} /><ClassificationSummary value={item.classification} /></li>)}</ul>
            : <div role="status" className="py-10 text-center"><p className="font-medium">{query.position || Object.keys(query.filters).length ? "조건에 맞는 자료가 없습니다." : "아직 수집된 자료가 없습니다."}</p><p className="mt-2 text-sm text-muted-foreground">Upload와 Google Connection이 연결되면 여기에 자료가 나타납니다.</p></div>}
          <nav aria-label="Library 페이지" className="mt-6 flex items-center justify-between border-t pt-4"><span className="text-sm text-muted-foreground">페이지당 최대 {query.limit}개</span><div className="flex gap-4 text-sm">{query.position && <Link href={libraryUrl(query)} className="underline">첫 페이지</Link>}{result.nextCursor && <Link href={libraryUrl(query, result.nextCursor)} className="underline">다음 페이지</Link>}</div></nav>
        </>}
    </AppShell>
  );
}
