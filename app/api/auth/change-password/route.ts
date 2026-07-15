import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";

// Shared by both the forced /change-password redirect (Shell.tsx, when
// profiles.must_change_password is true) and the real "Change Password"
// form in Settings -> User Profile.
export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { currentPassword, newPassword } = await request.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current and new password are required" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }

    // Re-verify the current password before allowing a change — cheap,
    // worthwhile hardening against a left-open/stolen session silently
    // taking over the account.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });
    if (updateError) throw updateError;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (profileError) throw profileError;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to change password" }, { status: 500 });
  }
}
