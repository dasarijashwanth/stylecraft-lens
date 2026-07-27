import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { logAuthEvent, countRecentAuthEvents } from "@/lib/db/auth-events";
import { getClientIp } from "@/lib/request-ip";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

// Server-side proxy for the same reason app/api/auth/login exists: lets a
// single email address (or IP) be rate-limited, this time against
// email-bombing a victim's inbox with reset links rather than credential
// guessing. Always returns {ok:true} regardless of outcome — never reveals
// whether the address is registered.
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");

  try {
    const { email } = await request.json();
    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const normalizedEmail = email.trim();

    const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const recentRequests = await countRecentAuthEvents({ email: normalizedEmail, eventType: "password_reset_requested", sinceIso });
    if (recentRequests >= RATE_LIMIT_MAX_ATTEMPTS) {
      // Still return ok:true — a rate-limit-specific error here would
      // itself leak information about request volume for that address.
      return NextResponse.json({ ok: true });
    }

    const origin = request.nextUrl.origin;
    const supabase = createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${origin}/api/auth/callback?next=/reset-password`,
    });

    await logAuthEvent({ eventType: "password_reset_requested", email: normalizedEmail, ipAddress: ip, userAgent });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // Fail open toward the generic confirmation — never surface a 500 that
    // could hint the address does/doesn't exist via error-message timing.
    return NextResponse.json({ ok: true });
  }
}
