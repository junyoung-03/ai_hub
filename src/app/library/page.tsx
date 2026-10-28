import { promotionalReady } from "@/lib/items/promotional-gate";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { LibraryList } from "@/components/library/library-list";
import { LibraryToolbar } from "@/components/library/library-toolbar";
import { requirePageUser } from "@/lib/supabase/auth";
import { encodeCursor, InvalidItemQueryError, libraryUrl, parseItemQuery } from "@/lib/items/filters";
import { listItems, type ItemList } from "@/lib/items/queries";
import { UploadControls } from "@/components/uploads/upload-controls";
import { ManualTextControls } from "@/components/items/manual-text-controls";
import { MaterialFocus } from "@/components/library/material-focus";
import { PageHeading } from "@/components/shell/page-heading";
import { ProcessingRefresh } from "@/components/items/processing-refresh";
import { SearchWorkspace } from "@/components/search/search-workspace";
import { getWorkspaceClock } from "@/components/workspace/request-clock";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const promotionalPromise = promotionalReady();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.set(key, value);
  }
  const searchTerms = params.getAll("q");
  const searchQuery = searchTerms.length === 1 ? searchTerms[0].trim().slice(0, 500) : "";
  if (searchQuery) {
    const [initialNow, promotionalEnabled] = await Promise.all([getWorkspaceClock(), promotionalPromise]);
    return <AppShell title="자료함" hideTitle workspace demo>
      <PageHeading title="자료함 검색" description="자료와 연결된 할 일을 검색합니다." />
      <SearchWorkspace key={searchQuery} initialQuery={searchQuery} initialNow={initialNow} promotionalEnabled={promotionalEnabled} backHref="/library" />
    </AppShell>;
  }
  params.delete("q");
  let query;
  try { query = parseItemQuery(params); }
  catch (error) {
    if (!(error instanceof InvalidItemQueryError)) throw error;
    return <AppShell title="자료함" workspace demo><div role="alert" className="space-y-3"><p>{error.message}</p><Link href="/library" className="text-sm underline">필터 초기화</Link></div></AppShell>;
  }
  let result: ItemList | null = null;
  let count: number|null=null;
  let atLeast=false;
  try {
    const countParams=new URLSearchParams(params); countParams.delete("cursor"); countParams.set("limit","100");
    if (!query.position) {
      const total = await listItems(parseItemQuery(countParams));
      const items = total.items.slice(0, query.limit);
      const last = items.at(-1);
      result = { items, nextCursor: (total.items.length > query.limit || total.nextCursor) && last ? encodeCursor(last, query) : null };
      count = total.items.length;
      atLeast = !!total.nextCursor;
    } else {
      const [page,total]=await Promise.allSettled([listItems(query),listItems(parseItemQuery(countParams))]);
      if(page.status==="fulfilled")result=page.value;
      if(total.status==="fulfilled"){count=total.value.items.length;atLeast=!!total.value.nextCursor;}
    }
  } catch { /* Keep raw Auth/DB errors out of UI and logs. */ }
  const promotionalEnabled = await promotionalPromise;
  return <AppShell title="자료함" hideTitle workspace demo>
    {result && <ProcessingRefresh items={result.items.flatMap(item => item.processing ? [{ id: item.id, processing: item.processing }] : [])}/>}
    <MaterialFocus/>
    <PageHeading title="자료함" description="메일·문서·파일을 한곳에서 확인하세요."><Link href="/library#add-material" className="workspace-primary"><Plus className="size-4" aria-hidden="true"/>자료 추가</Link></PageHeading>
    {!result&&<LibraryToolbar query={query} promotionalEnabled={promotionalEnabled}/>}
    {count!==null&&<p className="mb-3 text-right text-xs text-slate-400">{count}{atLeast?"개 이상":"개"}{Object.keys(query.filters).length?" · 필터 적용":" · 전체 자료"}</p>}
    {!result?<div role="alert" className="space-y-3"><p>자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p><a href={libraryUrl(query)} className="text-sm underline">다시 불러오기</a></div>:<>
      <LibraryList key={libraryUrl(query,params.get("cursor")??undefined)} items={result.items} filtered={Object.keys(query.filters).length > 0} toolbar={<LibraryToolbar query={query} promotionalEnabled={promotionalEnabled}/>}/>
      <nav aria-label="Library 페이지" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400"><span>페이지당 최대 {query.limit}개</span><div className="flex gap-4">{query.position&&<Link href={libraryUrl(query)} className="text-[#6d88b0]">첫 페이지</Link>}{result.nextCursor&&<Link href={libraryUrl(query,result.nextCursor)} className="text-[#6d88b0]">다음 페이지 →</Link>}</div></nav>
    </>}
    <section id="add-material" aria-label="자료 추가" className="workspace-card mt-8 scroll-mt-20 p-6"><div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="font-semibold text-slate-900">자료 추가</h2><p className="text-sm text-slate-500">PDF·이미지 업로드 또는 직접입력</p></div><UploadControls key={user.id} userId={user.id}/><ManualTextControls key={`manual-${user.id}`} userId={user.id}/></section>
  </AppShell>;
}
