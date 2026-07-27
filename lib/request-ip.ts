// lib/request-ip.ts
// Best-effort client IP extraction for rate limiting / audit logging.
// Vercel sets x-forwarded-for on every request; NextRequest.ip was removed
// in Next 13+ so this header is the only reliable source in a route handler.
import { NextRequest } from "next/server";

export function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}
