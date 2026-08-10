// lib/request-ip.ts
// Best-effort client IP extraction for rate limiting / audit logging.
// Vercel sets x-forwarded-for on every request; NextRequest.ip was removed
// in Next 13+ so this header is the only reliable source in a route handler.
//
// Security audit fix — x-forwarded-for is a chain of proxy hops appended
// left-to-right (each hop adds ITS OWN view of the connection to the
// right-hand end); Vercel's edge appends the real, verified connecting
// address as the LAST entry, but the LEFTMOST entries can be anything a
// client chooses to send in their own request (nothing strips a client-
// supplied x-forwarded-for before Vercel appends to it). Reading `[0]` (the
// first/leftmost entry) previously trusted exactly the attacker-controlled
// part of the chain — a caller could set `X-Forwarded-For: 1.2.3.4` to make
// every request appear to come from an arbitrary chosen address,
// defeating the IP half of login's email+IP rate limit (the email half is
// unaffected either way — a targeted single-account lockout still holds).
// Reading the LAST entry instead is the standard "trust the nearest-hop-
// appended value, never the client-asserted prefix" convention.
import { NextRequest } from "next/server";

export function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map(h => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return request.headers.get("x-real-ip");
}
