// Extracted from lib/gtm-derive.ts so lib/pricing-analysis.ts can import it
// without creating a circular dependency (gtm-derive.ts needs to import
// computeTiers/parsePriceToNumber FROM pricing-analysis.ts for the
// good_better_best derivation — see lib/gtm-tier6-inference.ts). Plain TS,
// no server-only imports.

// Generalized over the source-tag type so any caller (GTM/TDS field
// derivation, lib/pricing-analysis.ts's TargetPriceSource, etc.) can reuse
// the identical "first non-empty, N/A-aware" priority-pick discipline
// instead of reimplementing it.
export function pick<S extends string>(answer: string | undefined | null, source: S): { answer: string; source: S } | null {
  const trimmed = (answer ?? "").toString().trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A" || trimmed === "Not listed on product page") return null;
  return { answer: trimmed, source };
}

// First non-empty of a list of (value, source) candidates, in priority order.
export function firstOf<S extends string>(...candidates: [string | undefined | null, S][]): { answer: string; source: S } | null {
  for (const [value, source] of candidates) {
    const p = pick(value, source);
    if (p) return p;
  }
  return null;
}
