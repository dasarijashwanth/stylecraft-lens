// lib/asin-parse-client.ts
// Client-safe mirror of lib/analysisEngine.ts's resolveAsinFromInput — kept
// as its own tiny, dependency-free module (rather than only inlined in
// app/(app)/dashboard/analyze/page.tsx) so it's independently offline-
// testable (scripts/verify-related-products-form-validation.ts) and so any
// other client component needing the same cheap ASIN/URL check can import
// it directly. lib/analysisEngine.ts itself must never be imported from a
// "use client" file — it pulls in server-only Gemini/OpenAI/Rainforest
// dependencies. The server-side preview/replace routes remain the
// authoritative resolver; this is only for a fast local format check and
// duplicate-across-rows comparison before any network round-trip.
const ASIN_REGEX = /^[A-Z0-9]{10}$/i;
const ASIN_URL_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i;

export function resolveAsinLocal(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (ASIN_REGEX.test(trimmed)) return trimmed.toUpperCase();
  const match = trimmed.match(ASIN_URL_REGEX);
  return match ? match[1].toUpperCase() : null;
}
