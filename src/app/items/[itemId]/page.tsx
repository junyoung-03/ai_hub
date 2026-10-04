import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ClassificationSummary, ItemMetadata } from "@/components/items/item-summary";
import { requirePageUser } from "@/lib/supabase/auth";
import { getItemDetail, type ItemDetail } from "@/lib/items/queries";
import { formatTimestamp, locatorLabels } from "@/lib/items/presentation";

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requirePageUser();
  const { itemId } = await params;
  let data: ItemDetail | null;
  try { data = await getItemDetail(itemId); }
  catch {
    return <AppShell title="ITEM Detail"><div role="alert" className="space-y-3"><p>자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p><Link href="/library" className="text-sm underline">Library로 돌아가기</Link></div></AppShell>;
  }
  if (!data) notFound();
  const { item, classification, actions, evidence, original } = data;
  const types = { required: "필수", optional: "선택", check: "조건 확인" };
  return (
    <AppShell title="ITEM Detail">
      <Link href="/library" className="text-sm underline underline-offset-4">Library로 돌아가기</Link>
      <h2 className="mb-3 mt-5 break-words text-xl font-semibold">{item.title}</h2>
      <ItemMetadata item={item} />
      <p className="mt-2 text-xs text-muted-foreground">수정: <time dateTime={item.updatedAt}>{formatTimestamp(item.updatedAt)}</time></p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="original-title" className="min-w-0 space-y-4 rounded-lg border p-4">
          <h3 id="original-title" className="font-semibold">Original</h3>
          {data.gmail && <dl className="space-y-2 break-words text-sm">
            <div><dt className="inline text-muted-foreground">From: </dt><dd className="inline">{data.gmail.from || "발신자 정보 없음"}</dd></div>
            {data.gmail.to && <div><dt className="inline text-muted-foreground">To: </dt><dd className="inline">{data.gmail.to}</dd></div>}
            {data.gmail.dateHeader && <div><dt className="inline text-muted-foreground">Date header: </dt><dd className="inline">{data.gmail.dateHeader}</dd></div>}
          </dl>}
          {original.previewType === "google" ? original.url ? <a href={original.url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline underline-offset-4">Google 원본 열기</a> : <p className="text-sm text-muted-foreground">이 자료의 원본 링크를 사용할 수 없습니다.</p>
            : original.previewType === "upload" ? <p className="text-sm text-muted-foreground">업로드 원본 미리보기는 Upload Phase에서 연결됩니다.</p> : <p className="text-sm text-muted-foreground">직접 입력한 자료입니다.</p>}
          <h4 className="text-sm font-medium">콘텐츠</h4>
          {item.contentText ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.contentText}</p> : <p className="text-sm text-muted-foreground">아직 추출된 콘텐츠가 없습니다.</p>}
        </section>
        <section aria-labelledby="analysis-title" className="min-w-0 space-y-5 rounded-lg border p-4">
          <h3 id="analysis-title" className="font-semibold">AI Analysis</h3>
          <ClassificationSummary value={classification} detailed />
          <h4 className="border-t pt-4 font-medium">관련 Action / Evidence</h4>
          {!actions.length && <p className="text-sm text-muted-foreground">연결된 Action이 없습니다.</p>}
          {actions.map((action) => <article key={action.id} className="space-y-3 rounded-md border p-3">
            <h5 className="break-words font-medium">{action.title}</h5>
            <p className="text-xs text-muted-foreground">{types[action.type]} · {action.status === "completed" ? "완료" : "진행 중"}</p>
            <p className="text-sm">{action.deadlineStatus === "confirmed" ? `확정 마감일: ${action.deadlineAt ? formatTimestamp(action.deadlineAt) : action.deadlineDate}` : action.deadlineStatus === "needs_review" ? "마감일 확인 필요" : "마감일 없음"}</p>
            <ul className="space-y-3">{evidence.filter((source) => source.actionId === action.id).map((source) => <li key={source.id} className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">{source.isCurrent ? "Current Evidence" : "History Evidence"}{source.id === action.deadlineSourceId ? " · 마감일 근거" : ""}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{source.text}</p>
              {locatorLabels(source.locator).map((label) => <p key={label} className="break-words text-xs text-muted-foreground">{label}</p>)}
              <p className="text-xs text-muted-foreground">확인: {formatTimestamp(source.observedAt)}</p>
              <Link href={`/items/${source.itemId}`} className="text-xs underline">{source.itemId === item.id ? "현재 ITEM" : "연결된 다른 ITEM"}</Link>
            </li>)}</ul>
          </article>)}
        </section>
      </div>
    </AppShell>
  );
}
