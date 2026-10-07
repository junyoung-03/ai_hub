import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { ItemCard } from "@/components/items/item-summary";
import { LibraryFilters } from "@/components/items/library-filters";
import { requirePageUser } from "@/lib/supabase/auth";
import { InvalidItemQueryError, libraryUrl, parseItemQuery } from "@/lib/items/filters";
import { listItems, type ItemList } from "@/lib/items/queries";
import {UploadControls} from '@/components/uploads/upload-controls';
import {ManualTextControls} from '@/components/items/manual-text-controls';

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user=await requirePageUser();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.set(key, value);
  }
  let query;
  try { query = parseItemQuery(params); }
  catch (error) {
    if (!(error instanceof InvalidItemQueryError)) throw error;
    return <AppShell title="자료"><div role="alert" className="space-y-3"><p>{error.message}</p><Link href="/library" className="text-sm underline">필터 초기화</Link></div></AppShell>;
  }
  let result: ItemList | null = null;
  try { result = await listItems(query); }
  catch { /* Keep raw Auth/DB errors out of UI and logs. */ }
  return (
    <AppShell title="자료">
      <p className="mb-6 text-sm text-muted-foreground">메일, 문서, 일정과 직접 올린 자료를 한곳에서 확인하세요.</p>
      <UploadControls key={user.id} userId={user.id} />
      <ManualTextControls key={`manual-${user.id}`} userId={user.id} />
      <LibraryFilters query={query} />
      {!result ? <div role="alert" className="space-y-3"><p>자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p><a href={libraryUrl(query)} className="text-sm underline">다시 불러오기</a></div>
        : <>
          {result.items.length ? <ul className="list-surface">{result.items.map(item=><li key={item.id}><ItemCard item={item}/></li>)}</ul>
            : <div role="status" className="py-10 text-center"><p className="font-medium">{query.position || Object.keys(query.filters).length ? "조건에 맞는 자료가 없습니다." : "아직 수집된 자료가 없습니다."}</p><p className="mt-2 text-sm text-muted-foreground">파일을 올리거나 설정에서 Google 자료를 수집해 주세요.</p></div>}
          <nav aria-label="Library 페이지" className="mt-6 flex items-center justify-between border-t pt-4"><span className="text-sm text-muted-foreground">페이지당 최대 {query.limit}개</span><div className="flex gap-4 text-sm">{query.position && <Link href={libraryUrl(query)} className="underline">첫 페이지</Link>}{result.nextCursor && <Link href={libraryUrl(query, result.nextCursor)} className="underline">다음 페이지</Link>}</div></nav>
        </>}
    </AppShell>
  );
}
