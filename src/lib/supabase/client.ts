"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/** Auth client only; business data writes must use the Application API. */
export function createClient() {
  const { url, publishableKey } = getSupabaseConfig();

  // The official SSR browser client already reuses a browser singleton.
  return createBrowserClient<Database>(url, publishableKey);
}
