// lib/rate-limit.ts
// Reusable per-user rate limiting for expensive actions (starting an
// analysis, starting a project's generation pipeline) — protects the real
// OpenAI/Gemini/Rainforest spend those trigger, same motivation as the
// login/password-reset rate limits in app/api/auth/*. Backed by the same
// auth_events table (see lib/db/auth-events.ts) — one row per attempt,
// counted in a rolling window, never a mutable counter.
import { logAuthEvent, countRecentAuthEvents, type AuthEventType } from "@/lib/db/auth-events";

export interface RateLimitResult {
  limited: boolean;
  retryAfterMinutes: number;
}

export async function checkRateLimit(opts: {
  eventType: AuthEventType;
  userId: string;
  maxAttempts: number;
  windowMinutes: number;
}): Promise<RateLimitResult> {
  const sinceIso = new Date(Date.now() - opts.windowMinutes * 60 * 1000).toISOString();
  const count = await countRecentAuthEvents({ email: opts.userId, eventType: opts.eventType, sinceIso });
  if (count >= opts.maxAttempts) {
    return { limited: true, retryAfterMinutes: opts.windowMinutes };
  }
  // Logged as the "email" field for lack of a real email at most of this
  // helper's call sites — countRecentAuthEvents matches on it as an opaque
  // identity key regardless, so a userId works exactly the same way.
  await logAuthEvent({ eventType: opts.eventType, email: opts.userId, userId: opts.userId });
  return { limited: false, retryAfterMinutes: 0 };
}
