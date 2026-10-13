import type { User } from "@supabase/supabase-js";
import { ProductLanding } from "./product-landing";

export function LandingPage({ user }: { user: User | null }) {
  return <ProductLanding isLoggedIn={user !== null}/>;
}
