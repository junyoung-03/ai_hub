import { AppShell } from "@/components/shell/app-shell";
import { SearchWorkspace } from "@/components/search/search-workspace";

export default function ActionsPage() {
  return <AppShell title="할 일"><p className="mb-6 text-muted-foreground">해야 할 일과 마감일을 원문 근거와 함께 확인하세요.</p><SearchWorkspace initialQuery="해야 할 일" actions /></AppShell>;
}
