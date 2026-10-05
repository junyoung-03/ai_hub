import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ClassificationSummary, ItemMetadata } from "@/components/items/item-summary";
import { AnalyzeControl, OriginalAccess, SimilarItems } from "@/components/items/detail-tools";
import { deadlineLabel } from "@/components/search/search-results";
import { requirePageUser } from "@/lib/supabase/auth";
import { getItemDetail, type ItemDetail } from "@/lib/items/queries";
import { formatTimestamp, locatorLabels } from "@/lib/items/presentation";

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requirePageUser(); const {itemId}=await params; let data:ItemDetail|null;
  try{data=await getItemDetail(itemId);}catch{return <AppShell title="자료 상세"><div role="alert" className="panel"><p>자료를 불러오지 못했습니다.</p><a href={`/items/${itemId}`} className="btn-secondary mt-3">다시 시도</a></div></AppShell>;}
  if(!data)notFound(); const {item,classification,actions,evidence,original}=data;
  return <AppShell title={item.title}><Link href="/library" className="text-sm text-primary">← 자료로 돌아가기</Link><div className="mt-4"><ItemMetadata item={item}/></div>
    <div className="mt-6 flex gap-3 lg:hidden"><a href="#original-title" className="btn-secondary flex-1">원문</a><a href="#analysis-title" className="btn-secondary flex-1">분석·할 일</a></div>
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
      <section className="panel space-y-5" aria-labelledby="original-title"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="original-title" className="scroll-mt-6">원문</h2>{original.previewType==="google"&&original.url&&<a className="btn-secondary" href={original.url} target="_blank" rel="noopener noreferrer">Google 원본 ↗</a>}</div>
        <p className="meta">{original.previewType==="google"?"원본은 Google에 보관됩니다. 아래는 수집된 원문입니다.":"직접 올린 자료의 추출 내용입니다. 원본 파일과 함께 확인하세요."}</p>
        {original.previewType==="upload"&&<OriginalAccess itemId={item.id}/>}
        {data.gmail&&<dl className="space-y-2 break-words border-b pb-5 text-sm"><div><dt className="text-muted-foreground">보낸 사람</dt><dd>{data.gmail.from||"정보 없음"}</dd></div>{data.gmail.to&&<div><dt className="text-muted-foreground">받는 사람</dt><dd>{data.gmail.to}</dd></div>}</dl>}
        {data.calendar&&<div className="rounded-lg bg-muted p-4 text-sm"><p className="font-semibold">일정 날짜 · 행동 마감일과 별개</p><p>시작: {data.calendar.start?("date" in data.calendar.start?data.calendar.start.date:formatTimestamp(data.calendar.start.dateTime)):"미정"}</p><p>종료: {data.calendar.end?("date" in data.calendar.end?data.calendar.end.date:formatTimestamp(data.calendar.end.dateTime)):"미정"}{data.calendar.allDay?" (종일 · 종료일 미포함)":""}</p><p>{data.calendar.eventTimezone??data.calendar.calendarTimezone}</p></div>}
        {data.upload&&<p className="text-sm text-muted-foreground">파일 추출 상태와 AI 분석·검색 처리 상태는 별도로 표시합니다.</p>}
        {item.contentText?<div className="whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">{item.contentText}</div>:<p role="status" className="text-muted-foreground">아직 추출된 콘텐츠가 없습니다. 처리 상태를 확인해 주세요.</p>}
      </section>
      <aside className="panel space-y-6" aria-labelledby="analysis-title"><div className="border-l-2 border-primary pl-3"><h2 id="analysis-title" className="scroll-mt-6">분석과 할 일</h2><p className="meta mt-1">원문에서 확인된 정보</p></div><ClassificationSummary value={classification} detailed/>
        {data.aiAnalysis?<p className="meta">분석: {formatTimestamp(data.aiAnalysis.analyzedAt)}</p>:<p role="status" className="text-sm text-muted-foreground">검증된 AI 분석 결과가 아직 없습니다.</p>}
        {item.source==="gmail" && item.format==="email" && !data.aiAnalysis && <AnalyzeControl itemId={item.id}/>}
        <section className="space-y-4 border-t pt-5"><h3>해야 할 일</h3>{!actions.length&&<p className="text-muted-foreground">연결된 할 일이 없습니다.</p>}{actions.map(action=><article key={action.id} className="space-y-4 border-t pt-5"><div className="flex flex-wrap justify-between gap-3"><p className="text-sm text-muted-foreground">{{required:"해야 할 일",optional:"신청·선택",check:"조건 확인"}[action.type]}</p><span className="rounded-md bg-accent px-2 py-1 text-sm font-semibold text-primary">{deadlineLabel(action)}</span></div><h3 className="break-words text-base">{action.title}</h3><p className="text-sm">{action.deadlineStatus==="confirmed"?`마감: ${action.deadlineAt?formatTimestamp(action.deadlineAt):action.deadlineDate}`:action.deadlineStatus==="needs_review"?"마감일 확인 필요":"마감일 없음"}</p>{(action.startDate||action.startAt)&&<p className="text-sm">신청 시작: {action.startAt?formatTimestamp(action.startAt):action.startDate}</p>}{action.completedAt&&<p className="meta">완료: {formatTimestamp(action.completedAt)}</p>}
          {action.requirements.length>0&&<div><h4 className="font-medium">필요한 것</h4><ul className="mt-2 list-inside list-disc space-y-1 break-words text-sm">{action.requirements.map((v,i)=><li key={i}>{v}</li>)}</ul></div>}{action.conditions.length>0&&<div><h4 className="font-medium">적용 조건</h4><ul className="mt-2 list-inside list-disc space-y-1 break-words text-sm">{action.conditions.map((v,i)=><li key={i}>{v}</li>)}</ul></div>}
          <h4 className="font-medium">근거와 연결 자료</h4>{evidence.filter(s=>s.actionId===action.id).map(s=><div key={s.id} className="space-y-2"><p className="meta">{s.isCurrent?"현재 근거":"과거 근거"}{s.id===action.deadlineSourceId?" · 마감일 근거":""}</p><blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary/30 pl-3 text-sm leading-7">{s.text}</blockquote>{locatorLabels(s.locator).map(v=><p className="meta break-words" key={v}>{v}</p>)}{s.locator.evidence?.map((v,i)=><div key={i}><p className="text-sm break-words">{v.text}</p>{locatorLabels(v.locator).map(label=><p key={label} className="meta">{label}</p>)}</div>)}<Link className="text-sm text-primary" href={`/items/${s.itemId}`}>{s.itemId===item.id?"현재 자료의 원문":"연결된 자료 보기"} →</Link></div>)}
        </article>)}</section>
        {data.eventObservations.length>0&&<section className="space-y-3 border-t pt-5"><h3>일정 관찰 · 마감일 아님</h3>{data.eventObservations.map((event,i)=><div key={i}><p>{event.status==="confirmed"?event.datetime?formatTimestamp(event.datetime):event.date:"일정 날짜 확인 필요"}</p><blockquote className="break-words text-sm">{event.evidence.text}</blockquote>{locatorLabels(event.evidence.locator).map(v=><p className="meta" key={v}>{v}</p>)}</div>)}</section>}
      </aside>
    </div><SimilarItems itemId={item.id}/>
  </AppShell>;
}
