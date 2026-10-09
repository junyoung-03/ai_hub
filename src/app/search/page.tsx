import { AppShell } from "@/components/shell/app-shell";
import { SearchWorkspace } from "@/components/search/search-workspace";
import { getWorkspaceClock } from "@/components/workspace/request-clock";
import { EmptySearchRedirect } from "@/components/search/empty-search-redirect";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const initialQuery = typeof q === "string" ? q.trim().slice(0, 500) : "";
  if (!initialQuery) return <EmptySearchRedirect />;
  const initialNow = await getWorkspaceClock();
  return <AppShell title="검색" hideTitle demo><SearchWorkspace key={initialQuery} initialQuery={initialQuery} initialNow={initialNow} /></AppShell>;
}
