// lib/db/auth-events.ts
// Dual-path (Supabase/memoryDb) CRUD over auth_events — the security audit
// log AND the login-rate-limit backing store (see app/api/auth/login/route.ts
// and app/api/auth/forgot-password/route.ts). Mirrors lib/db/support-messages.ts's
// exact style.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockAuthEvent } from "@/lib/memoryDb";

export type AuthEventType =
  | "login_success"
  | "login_failure"
  | "password_change"
  | "password_reset_requested"
  | "permission_denied"
  | "admin_change";

export interface AuthEventInput {
  eventType: AuthEventType;
  email?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: string | null;
}

export interface AuthEventRow {
  id: string;
  event_type: string;
  email: string | null;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  detail: string | null;
  created_at: string;
}

function mockToRow(e: MockAuthEvent): AuthEventRow {
  return {
    id: e.id,
    event_type: e.eventType,
    email: e.email,
    user_id: e.userId,
    ip_address: e.ipAddress,
    user_agent: e.userAgent,
    detail: e.detail,
    created_at: e.createdAt.toISOString(),
  };
}

export async function logAuthEvent(input: AuthEventInput): Promise<void> {
  const email = input.email?.toLowerCase() || null;
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("auth_events").insert({
      event_type: input.eventType,
      email,
      user_id: input.userId ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      detail: input.detail ?? null,
    });
    if (error) console.error("[auth-events] failed to log event:", error.message);
    return;
  }
  memoryDb.authEvents.push({
    id: `authevt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    eventType: input.eventType,
    email,
    userId: input.userId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    detail: input.detail ?? null,
    createdAt: new Date(),
  });
}

// Used for rate limiting — counts matching events within a rolling window.
export async function countRecentAuthEvents(opts: {
  email?: string | null;
  ipAddress?: string | null;
  eventType: AuthEventType;
  sinceIso: string;
}): Promise<number> {
  const email = opts.email?.toLowerCase() || null;
  if (isSupabaseConfigured) {
    let query = supabaseAdmin
      .from("auth_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", opts.eventType)
      .gte("created_at", opts.sinceIso);
    // Rate-limit by whichever identity is available — email (account-level)
    // and/or IP (network-level) — matching "5 per 15 min per account+IP".
    if (email) query = query.eq("email", email);
    if (opts.ipAddress) query = query.eq("ip_address", opts.ipAddress);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }
  return memoryDb.authEvents.filter(e =>
    e.eventType === opts.eventType &&
    e.createdAt.toISOString() >= opts.sinceIso &&
    (!email || e.email === email) &&
    (!opts.ipAddress || e.ipAddress === opts.ipAddress)
  ).length;
}

export async function listRecentAuthEvents(limit = 200): Promise<AuthEventRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("auth_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }
  return memoryDb.authEvents
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(mockToRow);
}
