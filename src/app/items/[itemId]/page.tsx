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
import { formatTimestamp, locatorLabels } from "@/lib/items/presentation";
import { NoiseControls } from "@/components/items/noise-controls";

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requirePageUser();
  const { itemId } = await params;
  let data: ItemDetail | null;
  try { data = await getItemDetail(itemId); }
  catch { return <AppShell title="자료 상세"><div role="alert" className="panel"><p>자료를 불러오지 못했습니다.</p><a href={`/items/${itemId}`} className="btn-secondary mt-3">다시 시도</a></div></AppShell>; }
  if (!data) notFound();
  const { item, classification, actions, evidence, original } = data;
  const eligible = item.source === "gmail" || item.source === "drive" || item.source === "manual" || (item.source === "upload" && data.upload?.extractionStatus === "complete");

  const originalPane = <section className="min-w-0 rounded-xl border border-line bg-surface px-5 py-6 sm:px-8 sm:py-8" aria-labelledby="original-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="original-title">원문</h2>{original.previewType === "google" && original.url && <a className="btn-secondary" href={original.url} target="_blank" rel="noopener noreferrer">Google 원본 ↗</a>}</div>
    <p className="meta">{original.previewType === "google" ? "원본은 Google에 보관됩니다. 아래는 수집된 원문입니다." : original.previewType === "upload" ? "직접 올린 자료에서 추출한 내용입니다. 원본 파일과 함께 확인하세요." : "저장된 원문입니다."}</p>
    {original.previewType === "upload" && <OriginalAccess itemId={item.id} />}
    {data.gmail && <dl className="space-y-3 border-b pb-5 text-sm"><div><dt className="text-muted-foreground">보낸 사람</dt><dd className="break-all">{data.gmail.from || "정보 없음"}</dd></div>{data.gmail.to && <div><dt className="text-muted-foreground">받는 사람</dt><dd className="break-all">{data.gmail.to}</dd></div>}</dl>}
    {data.calendar && <div className="rounded-lg bg-muted p-4 text-sm"><p className="mb-2 font-semibold">일정 날짜 · 행동 마감일과 별개</p><p>시작: {data.calendar.start ? "date" in data.calendar.start ? data.calendar.start.date : formatTimestamp(data.calendar.start.dateTime) : "미정"}</p><p>종료: {data.calendar.end ? "date" in data.calendar.end ? data.calendar.end.date : formatTimestamp(data.calendar.end.dateTime) : "미정"}{data.calendar.allDay ? " (종일 · 종료일 미포함)" : ""}</p><p>{data.calendar.eventTimezone ?? data.calendar.calendarTimezone}</p></div>}
    {data.upload && <details className="border-b pb-5 text-sm"><summary className="cursor-pointer">파일 추출 · {{ complete: "완료", pending: "대기", running: "진행 중", failed: "실패" }[data.upload.extractionStatus]}</summary><p className="meta mt-3">파일 추출과 AI 분석은 별도로 처리됩니다.</p><ul className="mt-3 space-y-2">{data.upload.pages.map(page => <li key={page.page}>{page.page}페이지 · {page.method === "ocr" ? "문자 인식" : "문서 텍스트 추출"} · 문자 {page.start}–{page.end}</li>)}</ul></details>}
    {item.contentText ? <div className="mt-6 whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">{item.contentText}</div> : <p role="status" className="text-muted-foreground">아직 추출된 콘텐츠가 없습니다. 처리 상태를 확인해 주세요.</p>}
  </section>;

  const insightPane = <aside className="min-w-0 space-y-5 rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-20" aria-labelledby="analysis-title">
    {await promotionalReady() && <NoiseControls itemId={item.id}/>}
    <div><p className="mb-1 text-xs font-medium tracking-[0.08em] text-faint">AI INSIGHT</p><h2 id="analysis-title">분석과 할 일</h2>{data.aiAnalysis ? <p className="meta mt-2">분석 완료 · {formatTimestamp(data.aiAnalysis.analyzedAt)}</p> : item.processingStatus === "analyzing" ? <p role="status" className="mt-2 text-sm text-primary">AI 분석 중…</p> : item.processingStatus === "failed" ? <p role="alert" className="mt-2 text-sm text-destructive">AI 분석에 실패했습니다.</p> : <p role="status" className="mt-2 text-sm text-muted-foreground">검증된 AI 분석 결과가 아직 없습니다.</p>}</div>
    <section className="insight-section" aria-labelledby="actions-title"><h3 id="actions-title">해야 할 일 <span className="text-sm font-normal text-muted-foreground">{actions.length}개</span></h3>
      {!actions.length && <p className="text-muted-foreground">원문에서 확인된 할 일이 없습니다.</p>}
      {actions.map(action => <article key={action.id} className="space-y-3 border-t pt-5 first-of-type:border-0 first-of-type:pt-0">
        <p className="meta">{{ required: "해야 할 일", optional: "신청·선택", check: "조건 확인" }[action.type]} · {action.status === "completed" ? "완료" : "진행 중"}</p><h4 className="text-base font-medium">{action.title}</h4>
        <div className="border-b border-line pb-3"><p className="text-base font-medium text-ink">{deadlineLabel(action)}</p><p className="mt-1 text-sm">{action.deadlineStatus === "confirmed" ? `마감: ${action.deadlineAt ? formatTimestamp(action.deadlineAt) : action.deadlineDate}` : action.deadlineStatus === "needs_review" ? "원문에서 날짜를 다시 확인해 주세요." : "확정된 날짜 근거가 없습니다."}</p></div>
        {(action.startDate || action.startAt) && <p className="text-sm">신청 시작: {action.startAt ? formatTimestamp(action.startAt) : action.startDate}</p>}{action.completedAt && <p className="meta">완료: {formatTimestamp(action.completedAt)}</p>}
        {action.requirements.length > 0 && <div><h4 className="font-medium">필요한 것</h4><ul className="mt-2 list-inside list-disc space-y-1 text-sm">{action.requirements.map((value, i) => <li key={i}>{value}</li>)}</ul></div>}
        {action.conditions.length > 0 && <div><h4 className="font-medium">적용 조건</h4><ul className="mt-2 list-inside list-disc space-y-1 text-sm">{action.conditions.map((value, i) => <li key={i}>{value}</li>)}</ul></div>}
        <div className="space-y-4"><h4 className="font-medium">근거와 연결 자료</h4>{evidence.filter(source => source.actionId === action.id).map(source => <div key={source.id} className="space-y-2"><p className="meta">{source.isCurrent ? "현재 근거" : "과거 근거"}{source.id === action.deadlineSourceId ? " · 마감일 근거" : ""}</p><blockquote className="whitespace-pre-wrap border-l border-line pl-3 text-sm leading-6">{source.text}</blockquote>{locatorLabels(source.locator).map(value => <p className="meta" key={value}>{value}</p>)}
          {source.locator.evidence?.map((value, i) => <details key={i} className="text-sm"><summary className="cursor-pointer text-muted-foreground">추가 인용 근거</summary><p className="mt-2">{value.text}</p>{locatorLabels(value.locator).map(label => <p key={label} className="meta">{label}</p>)}</details>)}
          {source.itemId === item.id ? <p className="text-sm text-muted-foreground">현재 자료의 원문 근거</p> : <Link className="text-sm text-primary underline" href={`/items/${source.itemId}`}>연결된 자료 보기 →</Link>}
        </div>)}</div><ActionStateButton actionId={action.id} status={action.status} />
      </article>)}
    </section>
    {data.eventObservations.length > 0 && <section className="insight-section"><h3>일정 관찰 · 마감일 아님</h3>{data.eventObservations.map((event, i) => <div key={i} className="space-y-2"><p>{event.status === "confirmed" ? event.datetime ? formatTimestamp(event.datetime) : event.date : "일정 날짜 확인 필요"}</p><blockquote className="border-l-2 pl-3 text-sm">{event.evidence.text}</blockquote>{locatorLabels(event.evidence.locator).map(value => <p className="meta" key={value}>{value}</p>)}</div>)}</section>}
    <section className="insight-section"><h3>분류</h3><ClassificationSummary value={classification} detailed /><ClassificationEditor itemId={item.id} value={classification} /></section><SimilarItems itemId={item.id} />
    {eligible && <div className="border-t pt-5"><h3 className="mb-2 text-sm font-medium text-muted-foreground">AI 분석 관리</h3><AnalyzeControl itemId={item.id} status={item.processingStatus} analyzed={Boolean(data.aiAnalysis)} /></div>}
  </aside>;
  return <AppShell title={item.title}><Link href="/library" className="text-sm text-primary">← 자료로 돌아가기</Link><div className="mt-4"><ItemMetadata item={item} /></div><DetailLayout original={originalPane} insight={insightPane} /></AppShell>;
}
