import type { User } from "@supabase/supabase-js";
import { LandingHeader } from "./landing-header";
import { LandingHero } from "./landing-hero";
import { LandingProblem } from "./landing-problem";
import { LandingPillars } from "./landing-pillars";
import { LandingAnalysisDemo } from "./landing-analysis-demo";
import { LandingBento } from "./landing-bento";
import { LandingSyncPreview } from "./landing-sync-preview";
import { LandingSecurity } from "./landing-security";
import { LandingCta } from "./landing-cta";
import { LandingFooter } from "./landing-footer";

type LandingPageProps = {
  user: User | null;
};

export function LandingPage({ user }: LandingPageProps) {
  const isLoggedIn = user !== null;

  return (
    <div className="min-h-dvh bg-canvas text-ink antialiased">
      <LandingHeader isLoggedIn={isLoggedIn} />
      <main>
        <LandingHero isLoggedIn={isLoggedIn} />
        <LandingProblem />
        <LandingPillars />
        <LandingAnalysisDemo />
        <LandingBento />
        <LandingSyncPreview />
        <LandingSecurity />
        <LandingCta isLoggedIn={isLoggedIn} />
      </main>
      <LandingFooter />
    </div>
  );
}
