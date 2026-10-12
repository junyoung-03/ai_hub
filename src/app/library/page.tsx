import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { LibraryList } from "@/components/library/library-list";
import { LibraryToolbar } from "@/components/library/library-toolbar";
import { requirePageUser } from "@/lib/supabase/auth";
import { InvalidItemQueryError, libraryUrl, parseItemQuery } from "@/lib/items/filters";
import { listItems, type ItemList } from "@/lib/items/queries";
import { UploadControls } from "@/components/uploads/upload-controls";
import { ManualTextControls } from "@/components/items/manual-text-controls";
import { MaterialFocus } from "@/components/library/material-focus";

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
    return <AppShell title="자료" demo><div role="alert" className="space-y-3"><p>{error.message}</p><Link href="/library" className="text-sm underline">필터 초기화</Link></div></AppShell>;
  }
  let result: ItemList | null = null;
  let count: number|null=null;
  let atLeast=false;
  try {
    const countParams=new URLSearchParams(params); countParams.delete("cursor"); countParams.set("limit","100");
    const [page,total]=await Promise.allSettled([listItems(query),listItems(parseItemQuery(countParams))]);
    if(page.status==="fulfilled")result=page.value;
    if(total.status==="fulfilled"){count=total.value.items.length;atLeast=!!total.value.nextCursor;}
  } catch { /* Keep raw Auth/DB errors out of UI and logs. */ }
  return <AppShell title="자료" hideTitle demo>
    <MaterialFocus/>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight text-slate-800">자료</h1><p className="mt-2 text-xs text-slate-400 sm:text-sm">연결된 서비스와 직접 추가한 모든 자료</p></div><Link href="/library#add-material" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#cbd8ec] bg-white px-4 text-xs font-medium text-[#5f7fae]"><Plus className="size-3.5"/>자료 추가</Link></div>
    {!result&&<LibraryToolbar query={query}/>}
    {count!==null&&<p className="mb-3 text-right text-xs text-slate-400">{count}{atLeast?"개 이상":"개"}{Object.keys(query.filters).length?" · 필터 적용":" · 전체 자료"}</p>}
    {!result?<div role="alert" className="space-y-3"><p>자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p><a href={libraryUrl(query)} className="text-sm underline">다시 불러오기</a></div>:<>
      <LibraryList key={libraryUrl(query,params.get("cursor")??undefined)} items={result.items} toolbar={<LibraryToolbar query={query}/>}/>
      <nav aria-label="Library 페이지" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400"><span>페이지당 최대 {query.limit}개</span><div className="flex gap-4">{query.position&&<Link href={libraryUrl(query)} className="text-[#6d88b0]">첫 페이지</Link>}{result.nextCursor&&<Link href={libraryUrl(query,result.nextCursor)} className="text-[#6d88b0]">다음 페이지 →</Link>}</div></nav>
    </>}
    <section id="add-material" aria-label="자료 추가" className="mt-8 scroll-mt-20 border-t border-slate-200/60 pt-5"><div className="mb-4 flex items-center gap-5"><h2 className="text-sm font-semibold text-slate-600">자료 추가</h2><p className="text-xs text-slate-400">파일 업로드 또는 직접입력</p></div><UploadControls key={user.id} userId={user.id}/><ManualTextControls key={`manual-${user.id}`} userId={user.id}/></section>
  </AppShell>;
}
