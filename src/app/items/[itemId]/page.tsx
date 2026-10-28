import { promotionalReady } from "@/lib/items/promotional-gate";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ClassificationSummary, ItemMetadata } from "@/components/items/item-summary";
import { AnalyzeControl, OriginalAccess, SimilarItems } from "@/components/items/detail-tools";
import { DetailLayout } from "@/components/items/detail-layout";
import { ClassificationEditor, ActionStateButton } from "@/components/items/write-controls";
import { deadlineLabel } from "@/components/search/search-results";
import { requirePageUser } from "@/lib/supabase/auth";
import { getItemDetail, type ItemDetail } from "@/lib/items/queries";
import { formatTimestamp } from "@/lib/items/presentation";
import { NoiseControls } from "@/components/items/noise-controls";
import { SearchIndexControl } from "@/components/items/search-index-control";
import { ProcessingRefresh } from "@/components/items/processing-refresh";
import { createClient } from "@/lib/supabase/server";
import { analysisJobRpc } from "@/lib/items/analysis-job-rpc";
import { processingErrorMessage } from "@/lib/items/processing";

function actionDeadlineText(action: ItemDetail["actions"][number]) {
  if (action.deadlineStatus === "needs_review") return "마감일 확인 필요";
  if (action.deadlineStatus !== "confirmed") return "마감일 미정";
  if (action.deadlineAt) return `${formatTimestamp(action.deadlineAt)}까지`;
  if (!action.deadlineDate) return "마감일 확인 필요";
  const date = new Date(`${action.deadlineDate}T00:00:00+09:00`);
  if (!Number.isFinite(date.getTime())) return "마감일 확인 필요";
  return `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(date)}까지`;
}

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requirePageUser();
  const { itemId } = await params;
  let data: ItemDetail | null;
  try { data = await getItemDetail(itemId); }
  catch { return <AppShell title="자료 상세"><div role="alert" className="panel"><p>자료를 불러오지 못했습니다.</p><a href={`/items/${itemId}`} className="btn-secondary mt-3">다시 시도</a></div></AppShell>; }
  if (!data) notFound();
  const { item, classification, actions, evidence, original } = data;
  const eligible = data.processing.canAnalyze;
  let diagnosticResult: Awaited<ReturnType<typeof analysisJobRpc>> | null = null;
  if (item.processingStatus === "failed") try { diagnosticResult = await analysisJobRpc(await createClient(), "analysis_diagnostics", {p_item_id:item.id}); }
  catch { /* Diagnostics cannot prevent viewing the original item. */ }
  const diagnosticRows = Array.isArray(diagnosticResult?.data) ? diagnosticResult.data.filter(row => row && typeof row === "object" && !Array.isArray(row)).slice(0,10) : [];

  const originalPane = <section className="min-w-0 rounded-xl border border-line bg-surface px-5 py-6 sm:px-8 sm:py-8" aria-labelledby="original-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="original-title">원문</h2>{original.previewType === "google" && original.url && <a className="btn-secondary" href={original.url} target="_blank" rel="noopener noreferrer">Google 원본 ↗</a>}</div>
    <p className="meta">{original.previewType === "google" ? "원본은 Google에 보관됩니다. 아래는 수집된 원문입니다." : original.previewType === "upload" ? "직접 올린 자료에서 추출한 내용입니다. 원본 파일과 함께 확인하세요." : "저장된 원문입니다."}</p>
    {original.previewType === "upload" && <OriginalAccess itemId={item.id} />}
    {data.gmail && <dl className="space-y-3 border-b pb-5 text-sm"><div><dt className="text-muted-foreground">보낸 사람</dt><dd className="break-all">{data.gmail.from || "정보 없음"}</dd></div>{data.gmail.to && <div><dt className="text-muted-foreground">받는 사람</dt><dd className="break-all">{data.gmail.to}</dd></div>}</dl>}
    {data.calendar && <div className="rounded-lg bg-muted p-4 text-sm"><p className="mb-2 font-semibold">일정 날짜 · 행동 마감일과 별개</p><p>시작: {data.calendar.start ? "date" in data.calendar.start ? data.calendar.start.date : formatTimestamp(data.calendar.start.dateTime) : "미정"}</p><p>종료: {data.calendar.end ? "date" in data.calendar.end ? data.calendar.end.date : formatTimestamp(data.calendar.end.dateTime) : "미정"}{data.calendar.allDay ? " (종일 · 종료일 미포함)" : ""}</p><p>{data.calendar.eventTimezone ?? data.calendar.calendarTimezone}</p></div>}
    {data.upload && <details className="border-b pb-5 text-sm"><summary className="cursor-pointer">파일 추출 · {{ complete: "완료", pending: "대기", running: "진행 중", failed: "실패" }[data.upload.extractionStatus]}</summary><p className="meta mt-3">파일 추출과 AI 분석은 별도로 처리됩니다.</p><ul className="mt-3 space-y-2">{data.upload.pages.map(page => <li key={page.page}>{page.page}페이지 · {page.method === "ocr" ? "문자 인식" : "문서 텍스트 추출"} · 문자 {page.start}–{page.end}</li>)}</ul></details>}
    {item.contentText?.trim() ? <div className="mt-6 whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">{item.contentText}</div> : <p role="status" className="text-muted-foreground">{data.processing.message}</p>}
  </section>;

  const insightPane = <aside className="min-w-0 space-y-6 rounded-xl border border-line bg-surface p-4 sm:p-6" aria-label="AI 분석 결과">
    {item.source === "gmail" && await promotionalReady() && <NoiseControls itemId={item.id}/>}
    {item.processingStatus === "completed" && !data.aiAnalysis && <p role="status" className="text-sm text-muted-foreground">검증된 AI 분석 결과가 아직 없습니다.</p>}
    {item.processingStatus !== "completed" && <div role={item.processingStatus === "failed" && !data.processing.canPoll ? "alert" : "status"} className="text-sm text-muted-foreground"><p>{data.processing.message}</p></div>}
    {item.processingStatus === "failed" && <details className="text-sm"><summary className="cursor-pointer">분석 진단 기록</summary>
      {!diagnosticRows.length ? <p className="meta mt-2">이전 실패의 상세 기록이 없거나 진단 기록을 불러오지 못했습니다.</p> : <ul className="mt-2 space-y-2">{diagnosticRows.map((row,index) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return null;
        const code = typeof row.error_code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(row.error_code) ? row.error_code : null;
        const time = typeof row.occurred_at === "string" && Number.isFinite(Date.parse(row.occurred_at)) ? row.occurred_at : null;
        return <li key={index}>{time && <time dateTime={time}>{formatTimestamp(time)}</time>}{" · "}{typeof row.state === "string" ? row.state : "unknown"}{typeof row.attempt === "number" ? ` · ${row.attempt}회차` : ""}{code && <><br/><code>{code}</code><p>{processingErrorMessage(code) ?? "작업 상태를 확인해 주세요."}</p></>}</li>;
      })}</ul>}
    </details>}
    <section className="space-y-4" aria-labelledby="actions-title"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="actions-title" className="text-base font-semibold">할 일 <span className="ml-1 text-sm font-normal text-muted-foreground">{actions.length}개</span></h2>{data.aiAnalysis && item.processingStatus === "completed" && <span className="text-xs text-muted-foreground">분석 완료</span>}</div>
      {!actions.length && <p className="text-muted-foreground">원문에서 확인된 할 일이 없습니다.</p>}
      {actions.map(action => <article key={action.id} className="space-y-4 rounded-xl border border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1">{action.type !== "required" && <p className="mb-1 text-sm text-muted-foreground">{action.type === "optional" ? "신청·선택" : "조건 확인"}</p>}<h3 className="break-words text-lg font-semibold leading-7 sm:text-xl">{action.title}</h3></div><span className={`shrink-0 rounded-md px-2.5 py-1 text-sm font-medium ${action.status === "completed" ? "bg-green-soft text-green" : "bg-brand-soft text-ink"}`}>{action.status === "completed" ? "완료" : "진행 중"}</span></div>
        <div className="space-y-1 rounded-lg bg-muted px-4 py-3"><p className="text-sm text-muted-foreground">마감일</p><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className={`break-words text-2xl font-semibold leading-snug sm:text-3xl ${action.deadlineStatus === "confirmed" ? "text-ink" : "text-amber"}`}>{actionDeadlineText(action)}</p>{action.status !== "completed" && action.deadlineStatus === "confirmed" && <span className="text-base font-medium text-primary">{deadlineLabel(action)}</span>}</div></div>
        {(action.startDate || action.startAt) && <p className="text-sm">신청 시작 · {action.startAt ? formatTimestamp(action.startAt) : action.startDate}</p>}
        {action.requirements.length > 0 && <ul aria-label="필요한 것" className="space-y-1 text-base leading-7 text-ink">{action.requirements.map((value, i) => <li key={i}>{value}</li>)}</ul>}
        <details className="text-sm"><summary className="cursor-pointer text-primary">원문 근거 보기</summary><div className="mt-3 space-y-3">
          {evidence.filter(source => source.actionId === action.id).map(source => <div key={source.id} className="space-y-2"><p className="meta">{source.isCurrent ? "현재 근거" : "과거 근거"}{source.id === action.deadlineSourceId ? " · 마감일 근거" : ""}</p><blockquote className="whitespace-pre-wrap border-l border-line pl-3 leading-6">{source.text}</blockquote>
            {source.locator.evidence?.filter((value,index,quotes) => value.text !== source.text && quotes.findIndex(quote => quote.text === value.text) === index).map((value, i) => <blockquote key={i} className="whitespace-pre-wrap border-l border-line pl-3 leading-6">{value.text}</blockquote>)}
            {source.itemId === item.id ? <p className="meta">이 자료의 원문 근거입니다.</p> : <Link className="text-primary underline" href={`/items/${source.itemId}`}>연결된 자료 보기 →</Link>}
          </div>)}
          {action.conditions.length > 0 && <div className="space-y-2 border-t border-line pt-3"><h4 className="font-medium">원문에 기록된 조건</h4><ul className="list-inside list-disc space-y-1">{action.conditions.map((value,i) => <li key={i}>{value}</li>)}</ul></div>}
        </div></details>
        <ActionStateButton actionId={action.id} status={action.status} />
      </article>)}
    </section>
    {data.eventObservations.length > 0 && <section className="space-y-3 border-t border-line pt-5"><h2 className="text-base font-semibold">관련 일정 <span className="ml-1 text-sm font-normal text-muted-foreground">마감일과 별개</span></h2>{data.eventObservations.map((event, i) => <div key={i} className="space-y-1.5"><p className="text-lg font-semibold">{event.status === "confirmed" ? event.datetime ? formatTimestamp(event.datetime) : event.date : "일정 날짜 확인 필요"}</p><blockquote className="whitespace-pre-wrap break-words text-base leading-7 text-muted-foreground">{event.evidence.text}</blockquote></div>)}</section>}
    <section className="space-y-4 border-t border-line pt-5"><h2 className="text-base font-semibold">자료 분류</h2><ClassificationSummary value={classification} compact /><ClassificationEditor itemId={item.id} value={classification} /></section>
    <details className="border-t border-line pt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">비슷한 자료 보기</summary><SimilarItems itemId={item.id} /></details>
    {data.aiAnalysis && item.processingStatus === "indexing" && <SearchIndexControl itemId={item.id}/>}
    <details className="border-t border-line pt-3 text-sm" open={item.processingStatus === "failed" || !data.aiAnalysis}><summary className="cursor-pointer text-muted-foreground">처리 내역 · 분석 관리</summary><div className="mt-3 space-y-3">
      {data.aiAnalysis && <p className="meta">분석 완료 · {formatTimestamp(data.aiAnalysis.analyzedAt)}</p>}
      <p className="meta">{data.processing.message}</p>
      {data.processing.updatedAt && <p className="meta">최근 변경 · <time dateTime={data.processing.updatedAt}>{formatTimestamp(data.processing.updatedAt)}</time></p>}
      {actions.some(action => action.completedAt) && <ul className="space-y-1 text-xs text-muted-foreground">{actions.flatMap(action => action.completedAt ? [<li key={action.id}>{action.title} 완료 · {formatTimestamp(action.completedAt)}</li>] : [])}</ul>}
      {eligible && <AnalyzeControl itemId={item.id} status={item.processingStatus} analyzed={Boolean(data.aiAnalysis)} />}
    </div></details>
  </aside>;
  return <AppShell title={item.title} contentWidth="reading"><Link href="/library" className="text-sm text-primary">← 자료로 돌아가기</Link><div className="mt-4"><ItemMetadata item={item} processing={data.processing} /></div><ProcessingRefresh items={[{ id: item.id, processing: data.processing }]}/><DetailLayout original={originalPane} insight={insightPane} /></AppShell>;
}
