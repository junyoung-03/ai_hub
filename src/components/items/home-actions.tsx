import Link from "next/link";
import { listActions } from "@/lib/items/actions";
import { ActionCard } from "@/components/search/search-results";
import type { SearchActionResult } from "@/types/search-ui";

export async function HomeActions() {
  const rows: SearchActionResult[] = [];
  try {
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ status: "open", limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const page = await listActions(params);
      rows.push(...page.results); cursor = page.nextCursor;
    } while (cursor);
  } catch { return <div className="panel" role="alert">할 일을 불러오지 못했습니다. <Link href="/" className="underline">다시 불러오기</Link></div>; }
  // Importance is not an API field. Rank only confirmed deadlines, then required tasks.
  const deadline = (action: SearchActionResult) => action.deadlineAt ?? `${action.deadlineDate}T23:59:59+09:00`;
  const due = rows.filter(action => action.deadlineStatus === "confirmed").sort((a, b) => Date.parse(deadline(a)) - Date.parse(deadline(b)) || Number(b.type === "required") - Number(a.type === "required"));
  const review = rows.filter(action => action.deadlineStatus !== "confirmed" || action.type === "check");
  return <div className="space-y-8">
    <section aria-labelledby="home-due-title"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="home-due-title">먼저 챙길 마감</h2><Link href="/actions" className="text-sm text-primary">할 일 전체 →</Link></div><p className="meta mb-4">확정된 마감이 가까운 순서입니다. 근거와 함께 확인하세요.</p>
      {due.length ? <div className="space-y-3.5">{due.slice(0, 3).map(action => <ActionCard key={action.actionId} action={action} compact />)}</div> : <p className="border-y py-6 text-muted-foreground">확정된 마감이 있는 할 일이 없습니다.</p>}
    </section>
    <section aria-labelledby="home-review-title"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="home-review-title">확인 필요</h2><Link href="/actions" className="text-sm text-primary">전체 보기 →</Link></div>
      {review.length ? <div className="space-y-3.5">{review.slice(0, 3).map(action => <ActionCard key={action.actionId} action={action} compact />)}</div> : <p className="border-y py-6 text-muted-foreground">날짜나 조건을 확인할 할 일이 없습니다.</p>}
    </section>
  </div>;
}
