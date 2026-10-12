import { getCurrentUser } from "@/lib/supabase/auth";
import { LandingPage } from "@/components/landing/landing-page";
import { TodayView } from "@/components/home/today-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ includePromotional?: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return <LandingPage user={null} />;
  }

  return <TodayView includePromotional={(await searchParams).includePromotional === "true"} />;
}
