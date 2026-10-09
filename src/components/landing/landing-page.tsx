import type { User } from "@supabase/supabase-js";
import { SearchFirstLanding } from "./search-first-landing";

export function LandingPage({ user }: { user: User | null }) {
  return <SearchFirstLanding isLoggedIn={user !== null}/>;
}
