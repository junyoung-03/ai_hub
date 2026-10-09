import Link from "next/link";
import { FileSearch, Sparkles } from "lucide-react";
import type { SearchPageResponse, SearchLocation } from "@/types/search-ui";
import { ActionStateButton } from "@/components/items/write-controls";
import { SourceBadge } from "@/components/workspace/workspace-ui";
import { actionDay, dayInSeoul, dDay, isOverdue, shortDate } from "@/components/actions/schedule-model";
import { Location } from "./search-results";

type Evidence = { itemId: string; title: string; source: string; text: string; location: SearchLocation };
const evidenceKey = (entry: Evidence) => JSON.stringify([entry.itemId, entry.text, entry.location]);

/** Presentation of returned results only; never synthesizes an AI answer or deadline. */
export function SearchDemoResults({ page, query, now }: { page: SearchPageResponse; query: string; now: number }) {
  const evidence: Evidence[] = [];
  const numbers = new Map<string, number>();
  const resultEvidence = page.results.map(result => {
    const entries: Evidence[] = result.kind === "action" ? result.sources : result.matchedChunks.map(match => ({ itemId: result.itemId, title: result.title, source: result.source, text: match.excerpt, location: match.location }));
    return entries.filter(entry => entry.text.trim()).map(entry => {
      const key = evidenceKey(entry);
      if (!numbers.has(key)) { evidence.push(entry); numbers.set(key, evidence.length); }
      return numbers.get(key)!;
    });
  });
  const today = dayInSeoul(now);
  const actions = page.results.filter(result => result.kind === "action");
  const confirmed = actions.filter(action => actionDay(action) && action.status !== "completed");
  const overdue = confirmed.filter(action => isOverdue(action, today, now));
  const citations = (indices: number[]) => [...new Set(indices)].map(number => <a key={number} href={`#search-evidence-${number}`} aria-label={`원문 근거 ${number} 보기`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-[#edf2ff] text-[11px] font-semibold text-[#5676b1] hover:bg-[#dce7ff]">{number}</a>);
  return <div data-search-ready="true" className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
    <section aria-label="검색 결과" className="min-w-0 space-y-5">
      <div><h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900">{query}</h1><p className="mt-2 text-xs text-slate-500">불러온 결과 {page.results.length}개{page.nextCursor ? " · 추가 결과 있음" : ""}{typeof page.coverage?.totalItems === "number" ? ` · 검색 대상 자료 ${page.coverage.totalItems}개` : ""}</p></div>
      <div className="py-1"><p className="flex items-center gap-2 text-xs font-medium text-[#6e86b0]"><Sparkles className="size-3.5" aria-hidden="true"/>검색 정리</p><p className="mt-2 text-sm leading-7 text-slate-700">현재 결과에서 자료 <strong>{page.results.length - actions.length}개</strong>, 할 일 <strong>{actions.length}개</strong>를 찾았어요.{confirmed.length > 0 && <> 확정된 미완료 마감은 <strong>{confirmed.length}개</strong>{overdue.length > 0 ? `이며, 이 중 ${overdue.length}개는 기한이 지났어요.` : "예요."}</>} 원문 근거를 함께 확인하세요.</p></div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 divide-y divide-slate-100">
        {page.results.map((result, index) => {
          const action = result.kind === "action" ? result : null;
          const date = action ? actionDay(action) : "";
          const late = action ? isOverdue(action, today, now) : false;
          const lead = action?.sources[0];
          const href = `/items/${action ? lead?.itemId ?? "" : result.kind === "item" ? result.itemId : ""}`;
          return <article key={result.kind === "action" ? result.actionId : result.itemId} className="flex min-w-0 gap-3 px-4 py-5 sm:gap-4 sm:px-5">
            <span className="hidden w-4 shrink-0 pt-3 text-xs tabular-nums text-slate-400 sm:block">{index + 1}</span>
            {action ? <div className={`flex w-14 shrink-0 flex-col items-center justify-center self-start rounded-xl border px-1 py-2 ${late ? "border-rose-100 bg-rose-50 text-rose-600" : "border-[#e1e8f7] bg-[#f3f6fd] text-[#5e7fb8]"}`}>
              {date ? <><span className="text-[10px]">{Number(date.slice(5, 7))}월</span><span className="text-xl font-semibold leading-7">{Number(date.slice(8, 10))}</span><span className="text-[10px]">{shortDate(date).match(/\((.*?)\)/)?.[1]}</span></> : <span className="py-2 text-center text-[11px]">날짜<br/>확인</span>}
            </div> : <div className="pt-1"><SourceBadge source={result.kind === "item" ? result.source : ""} iconOnly/></div>}
            <div className="min-w-0 flex-1">
              {action && <p className="mb-1.5 text-[11px] text-[#6e86b0]">{action.type === "required" ? "해야 할 일" : action.type === "optional" ? "신청·선택" : "조건 확인"}{date ? " · 마감" : action.deadlineStatus === "needs_review" ? " · 마감일 확인 필요" : " · 마감일 없음"}</p>}
              <div className="flex flex-wrap items-center gap-1.5"><h2 className={`min-w-0 break-words text-sm font-semibold ${action?.status === "completed" ? "text-slate-400 line-through" : "text-slate-800"}`}>{!action || lead ? <Link href={href} className="hover:text-[#557bb9] hover:underline">{result.title}</Link> : result.title}</h2>{citations(resultEvidence[index])}</div>
              {action ? <>
                {lead && <div className="mt-2 flex flex-wrap items-center gap-2"><SourceBadge source={lead.source}/><span className="break-words text-xs text-slate-500">{lead.title}{action.sources.length > 1 ? ` · 출처 ${action.sources.length}곳` : ""}</span></div>}
                {action.requirements.length > 0 && <p className="mt-2 break-words text-xs leading-5 text-slate-500">필요한 것 · {action.requirements.join(" · ")}</p>}
                {action.conditions.length > 0 && <p className="mt-1 break-words text-xs leading-5 text-slate-500">조건 · {action.conditions.join(" · ")}</p>}
                {date && <p className="mt-2 text-[11px] text-slate-400">마감 {shortDate(action.deadlineAt ?? date)}</p>}
                {!lead && <p className="mt-2 text-xs text-slate-500">연결된 원문 근거가 없습니다.</p>}
              </> : result.kind === "item" && <><p className="mt-1.5 text-xs text-slate-400">{result.sourceDate ? shortDate(result.sourceDate) : "원본 날짜 없음"}</p><p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-500">{result.excerpt || result.matchedChunks[0]?.excerpt || "본문 근거가 없는 결과입니다. 상세에서 확인하세요."}</p><Link href={href} className="mt-2 inline-block text-xs text-[#6e86b0] hover:underline">원문과 분석 보기 →</Link></>}
            </div>
            {action && <div className="flex w-20 shrink-0 flex-col items-end gap-3"><span className={`rounded-md px-2 py-1 text-[11px] font-medium ${late ? "bg-rose-50 text-rose-600" : "bg-[#eef3fd] text-[#5d7cb0]"}`}>{dDay(action, today)}</span><ActionStateButton actionId={action.actionId} status={action.status}/></div>}
          </article>;
        })}
      </div>
    </section>
    <aside aria-label="원문 근거" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-medium text-slate-600"><FileSearch className="size-4" aria-hidden="true"/>원문 근거 <span className="text-xs text-slate-400">{evidence.length}</span></h2><p className="text-[11px] text-slate-400">검색 결과와 연결된 원문 발췌</p></div>
      <div className="space-y-3">{evidence.map((entry, index) => <article id={`search-evidence-${index + 1}`} key={evidenceKey(entry)} className="scroll-mt-20 rounded-2xl border border-slate-200/80 bg-white/85 p-4 target:ring-2 target:ring-[#cad9f3]">
        <div className="flex items-start gap-2"><span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-[#edf2ff] text-[11px] font-semibold text-[#5676b1]">{index + 1}</span><SourceBadge source={entry.source} iconOnly/><h3 className="min-w-0 break-words text-xs font-medium leading-5 text-slate-700"><Link href={`/items/${entry.itemId}`} className="hover:underline">{entry.title}</Link></h3></div>
        <blockquote className="my-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600"><mark className="rounded bg-[#f0f4ff] px-1 text-inherit">{entry.text}</mark></blockquote>
        <Location value={entry.location}/><Link href={`/items/${entry.itemId}`} className="mt-2 inline-block text-xs text-[#6e86b0] hover:underline">원문에서 보기 →</Link>
      </article>)}</div>
      {!evidence.length && <p className="rounded-2xl border border-slate-200/80 bg-white/70 p-5 text-sm leading-6 text-slate-500">반환된 원문 발췌가 없습니다. 자료 상세에서 내용을 확인하세요.</p>}
    </aside>
  </div>;
}
