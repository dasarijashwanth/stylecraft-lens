import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Marks the first-login "New here? Read the Getting Started FAQ" banner
// dismissed for the CURRENT real Supabase Auth user — persisted so it
// never reappears on another device/session (see lib/auth.ts's
// faqBannerDismissedAt). A no-op success in fallback/dev auth modes (no
// real profile row to persist against — see lib/auth.ts's ALREADY_DISMISSED
// precedent for those paths already showing the banner as dismissed).
export async function POST() {
  try {
    await getAuthSession(); // just to enforce "must be signed in"

    if (isSupabaseConfigured) {
      const supabase = createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ faq_banner_dismissed_at: new Date().toISOString() })
          .eq("id", user.id);
        if (error) throw error;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to dismiss banner" }, { status: 500 });
  }
}
