import { getWorkspaceClock } from "@/components/workspace/request-clock";
import { AppShell } from "@/components/shell/app-shell";
import { ScheduleWorkspace } from "@/components/actions/schedule-workspace";
import { dayInSeoul } from "@/components/actions/schedule-model";
export default async function ActionsPage() {
  const now=await getWorkspaceClock();
  return <AppShell title="할 일 · 일정" hideTitle demo><ScheduleWorkspace today={dayInSeoul(now)} now={now}/></AppShell>;
}
