import { getCurrentUser } from "@/lib/supabase/auth";
import { LandingPage } from "@/components/landing/landing-page";
import { TodayView } from "@/components/home/today-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ includePromotional?: string; preview?: string; addModal?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();

  if (!user && params.preview !== "true") {
    return <LandingPage user={null} />;
  }

  return <TodayView addModal={params.addModal === "true"} />;
}
