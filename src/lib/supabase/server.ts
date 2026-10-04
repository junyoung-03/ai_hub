import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

import { getSupabaseConfig } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

// React cache reuses a client within a Server Component render, never globally.
export const createClient = cache(async () => {
  const { url, publishableKey } = getSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components have read-only cookies. Proxy persists refreshed
          // cookies and cache headers before rendering; Actions/Handlers can write.
        }
      },
    },
  });
});
