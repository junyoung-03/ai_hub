import { getWorkspaceClock } from "@/components/workspace/request-clock";
import { AppShell } from "@/components/shell/app-shell";
import { dayInSeoul } from "@/components/actions/schedule-model";
import { TodayDashboard } from "./today-dashboard";

export async function TodayView({ addModal = false }: { addModal?: boolean } = {}) {
  const now = await getWorkspaceClock();
  return (
    <AppShell title="오늘" hideTitle demo homeBackground>
      <TodayDashboard today={dayInSeoul(now)} initialAddModal={addModal} />
    </AppShell>
  );
}
