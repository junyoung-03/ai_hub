import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

import {
  getSupabaseConfig,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

export async function updateSession(request: NextRequest) {
  // The existing public scaffold stays usable before local env setup.
  // Protected entry points must call requireUser(), which fails without config.
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  const { url, publishableKey } = getSupabaseConfig();
  const cacheHeaders = new Headers({ "Cache-Control": "private, no-store" });
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        // Rebuild the forwarded request after refreshing its cookies. Preserve
        // earlier writes: SSR sends cache headers only on the first setAll call.
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        previousCookies.forEach((cookie) => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headersToSet).forEach(([name, value]) => {
          cacheHeaders.set(name, value);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const protectedRoute =
    ["/library", "/items", "/search", "/actions", "/settings"].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );

  // Claims only control navigation. Every protected page verifies getUser()
  // on the server. /login redirects only after getUser(), avoiding stale-JWT loops.
  if (protectedRoute && (error || !data?.claims)) {
    // Next.js Proxy requires an absolute Location; only the fixed local path
    // is used, never a query-supplied redirect or forwarded-host header.
    const redirectResponse = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    response = redirectResponse;
  }

  cacheHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}
