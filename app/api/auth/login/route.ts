import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { logAuthEvent, countRecentAuthEvents } from "@/lib/db/auth-events";
import { getClientIp } from "@/lib/request-ip";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

// Login now goes through this server route (rather than the browser calling
// supabase.auth.signInWithPassword directly) specifically so failed
// attempts can be rate-limited and every attempt audit-logged — see
// lib/db/auth-events.ts. Sets the same session cookies the direct client
// call would have (createSupabaseServerClient's setAll writes via
// next/headers' cookies(), which Route Handlers are allowed to do).
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");

  try {
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    const normalizedEmail = email.trim();

    const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const [byEmail, byIp] = await Promise.all([
      countRecentAuthEvents({ email: normalizedEmail, eventType: "login_failure", sinceIso }),
      ip ? countRecentAuthEvents({ ipAddress: ip, eventType: "login_failure", sinceIso }) : Promise.resolve(0),
    ]);
    if (byEmail >= RATE_LIMIT_MAX_ATTEMPTS || byIp >= RATE_LIMIT_MAX_ATTEMPTS) {
      await logAuthEvent({ eventType: "login_failure", email: normalizedEmail, ipAddress: ip, userAgent, detail: "rate_limited" });
      return NextResponse.json({ error: "Too many attempts — please wait 15 minutes and try again" }, { status: 429 });
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });

    if (error || !data.user) {
      await logAuthEvent({ eventType: "login_failure", email: normalizedEmail, ipAddress: ip, userAgent });
      // Never leak which field was wrong (Section 2.3).
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }

    await logAuthEvent({ eventType: "login_success", email: normalizedEmail, userId: data.user.id, ipAddress: ip, userAgent });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to sign in — try again" }, { status: 500 });
  }
}
