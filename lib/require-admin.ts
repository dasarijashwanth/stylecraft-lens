// lib/require-admin.ts
// Centralizes the requireAdmin(role) check that was previously copy-pasted
// into every admin/* route file (confirmed identical in all ~25 of them
// during the authorization audit) — and, new here, actually logs the
// permission_denied audit event Section 9 asks for, which no route
// previously did (each just threw a 403 with nothing recorded). New admin
// routes should import this instead of redefining their own copy; existing
// routes can be migrated incrementally without any behavior change (same
// thrown error shape).
import { logAuthEvent } from "@/lib/db/auth-events";

export function requireAdmin(session: { role: string; email?: string; userId?: string }, routeLabel?: string): void {
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    // Best-effort — a logging hiccup must never block the 403 itself.
    logAuthEvent({
      eventType: "permission_denied",
      email: session.email,
      userId: session.userId,
      detail: routeLabel ? `role=${session.role} route=${routeLabel}` : `role=${session.role}`,
    }).catch(() => {});
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}
