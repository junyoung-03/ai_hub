import { getCurrentUser } from "@/lib/supabase/auth";
import { LandingPage } from "@/components/landing/landing-page";

export default async function LandingRoute() {
  const user = await getCurrentUser();
  return <LandingPage user={user} />;
}
