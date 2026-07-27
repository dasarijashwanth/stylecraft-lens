import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";
import { validatePassword } from "@/lib/password-policy";
import { logAuthEvent } from "@/lib/db/auth-events";
import { getClientIp } from "@/lib/request-ip";

// Shared by both the forced /change-password redirect (Shell.tsx, when
// profiles.must_change_password is true) and the real "Change Password"
// form in Settings -> User Profile.
export async function POST(request: NextRequest) {
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
    const validation = validatePassword(newPassword);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Re-verify the current password before allowing a change — cheap,
    // worthwhile hardening against a left-open/stolen session silently
    // taking over the account. Uses a throwaway anon client rather than the
    // cookie-bound request client, so this verification sign-in can never
    // clobber the caller's existing session cookies mid-request.
    const { createClient } = await import("@supabase/supabase-js");
    const verifyClient = createClient(
      (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, ""),
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
    const { error: verifyError } = await verifyClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      console.error("change-password: verify signInWithPassword failed:", {
        message: verifyError.message,
        status: (verifyError as any).status,
        code: (verifyError as any).code,
        email: user.email,
      });
      // Surface the real reason (e.g. a rate limit) instead of always
      // claiming the password itself was wrong, which was masking the
      // actual cause.
      return NextResponse.json({ error: verifyError.message || "Current password is incorrect" }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });
    if (updateError) {
      console.error("change-password: updateUserById failed:", updateError);
      return NextResponse.json({ error: updateError.message || "Failed to update password" }, { status: updateError.status || 400 });
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (profileError) {
      console.error("change-password: profiles update failed:", profileError);
      return NextResponse.json({ error: profileError.message || "Failed to update profile" }, { status: 500 });
    }

    // Revoke every OTHER active session/device for this account — a
    // changed password should mean a previously-stolen/left-open session
    // elsewhere stops working. Keeps the CURRENT session (this request's
    // own token) alive via scope:'others'. Best-effort: never fails the
    // password change itself over this.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabaseAdmin.auth.admin.signOut(session.access_token, "others");
      }
    } catch (e) {
      console.error("change-password: failed to revoke other sessions:", e);
    }

    await logAuthEvent({
      eventType: "password_change",
      email: user.email,
      userId: user.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("change-password: unexpected error:", err);
    return NextResponse.json({ error: err.message || "Failed to change password" }, { status: 500 });
  }
}
