import { getWorkspaceClock } from "@/components/workspace/request-clock";
import { AppShell } from "@/components/shell/app-shell";
import { PlannerWorkspace } from "@/components/actions/planner-workspace";
import { dayInSeoul } from "@/components/actions/schedule-model";
export default async function ActionsPage() {
  const now=await getWorkspaceClock();
  return <AppShell title="플래너" hideTitle workspace demo><PlannerWorkspace today={dayInSeoul(now)} now={now}/></AppShell>;
}
