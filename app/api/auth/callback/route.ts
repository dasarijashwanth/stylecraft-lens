import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Exchanges a Supabase Auth PKCE `code` (from a password-recovery email
// link, or any future magic-link/OAuth flow) for a real cookie-backed
// session, then redirects onward. Recovery links point here via
// resetPasswordForEmail's redirectTo (see app/(auth)/forgot-password) —
// the resulting session is what lets /reset-password call
// supabase.auth.updateUser({ password }) without re-authenticating.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";

  if (code) {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`);
}
