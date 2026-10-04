import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

function finish(location: "/" | "/login?error=auth_callback" | "/login?error=profile_setup") {
  // Relative, fixed destinations ignore Host/forwarded headers and any next URL.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const codes = params.getAll("code");
  if (params.has("error") || codes.length !== 1 || !codes[0]?.trim()) {
    return finish("/login?error=auth_callback");
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(codes[0]);
    if (error) return finish("/login?error=auth_callback");

    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) return finish("/login?error=auth_callback");

    // Auth creation does not guarantee a service profile. Read only this user's
    // ID through RLS; the existing DB trigger owns profile creation.
    const { data: profile, error: profileError } = await supabase
      .from("users").select("id").eq("id", data.user.id).maybeSingle();
    if (profileError || !profile) {
      await supabase.auth.signOut({ scope: "local" });
      return finish("/login?error=profile_setup");
    }
    return finish("/");
  } catch {
    // Never reflect provider errors, codes, tokens, or metadata in the response.
    return finish("/login?error=auth_callback");
  }
}
