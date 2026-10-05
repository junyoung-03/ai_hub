import { AppShell } from "@/components/shell/app-shell";
import { SearchWorkspace } from "@/components/search/search-workspace";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const initialQuery = typeof q === "string" ? q.slice(0, 500) : "";
  return <AppShell title="흩어진 정보, 한 번에 검색"><SearchWorkspace key={initialQuery} initialQuery={initialQuery} /></AppShell>;
}
