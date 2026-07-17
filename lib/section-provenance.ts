// lib/section-provenance.ts
// Shared, normalized shape for "where did this section's data come from" —
// which source tiers were attempted, their outcomes, the verbatim queries
// run, item counts used vs. rejected (with reasons where obtainable), and
// timing. Generalizes lib/amazon-review-analysis.ts's TierResult (the
// richest of the three resolver-specific shapes that existed before this)
// so Key Features, Reviews, News, and Pricing can all populate the same
// persisted record (see lib/db/section-provenance.ts).
export type ProvenanceSection = "key_features" | "reviews" | "news" | "pricing";

// "skipped" = a tier intentionally not attempted because an earlier tier
// already found enough, or a time budget was hit — distinct from "empty"
// (attempted, found nothing) and "error" (attempted, request failed).
// "partial" is available for an aggregated multi-item tier (e.g. pricing
// across several competitors) where some succeeded and some didn't.
export type ProvenanceOutcome = "success" | "empty" | "error" | "skipped" | "partial";

export interface ProvenanceTier {
  tier: string;
  attempted: boolean;
  outcome: ProvenanceOutcome;
  itemCount?: number;
  rejectedCount?: number;
  rejectedReasons?: string[];
  sourceUrls?: string[];
  elapsedMs?: number;
  errorMessage?: string;
}

export interface ProvenanceQuery {
  tier?: string;
  query: string;
  outcome?: ProvenanceOutcome;
  itemCount?: number;
  elapsedMs?: number;
  // True for every code-verified query (all resolvers, by default). False
  // ONLY for the News resolver's self-reported "excluded, not product-
  // specific" source mentions — an unverified, model-self-reported count,
  // never presented with the same confidence as a code-checked one (matches
  // lib/citations.ts's UNVERIFIED_LABEL convention).
  verified: boolean;
  rejectedCount?: number;
  rejectedReasons?: string[];
}

export interface SectionProvenanceData {
  tiers: ProvenanceTier[];
  queries: ProvenanceQuery[];
}

// Adapts lib/amazon-review-analysis.ts's existing TierResult (tier/
// attempted/outcome/itemCount/errorMessage, outcome restricted to
// success|empty|error) into the normalized shape — an unattempted tier
// becomes "skipped" here, closing the gap the bare TierResult couldn't
// express.
export function fromTierResult(t: {
  tier: string;
  attempted: boolean;
  outcome: "success" | "empty" | "error";
  itemCount?: number;
  errorMessage?: string;
}): ProvenanceTier {
  return {
    tier: t.tier,
    attempted: t.attempted,
    outcome: t.attempted ? t.outcome : "skipped",
    itemCount: t.itemCount,
    errorMessage: t.errorMessage,
  };
}

// Pure, synchronous — pricing has no separate query/search step of its own;
// its "tier" is simply "did the Rainforest product lookup (already
// performed elsewhere) resolve a real price for this competitor." No async
// work, no server-only imports (mirrors lib/pricing-analysis.ts's own
// portability rule, importable from client and server code alike).
export function buildPricingProvenanceTier(c: {
  price_raw?: number | null;
  price?: string | null;
  source_url?: string | null;
  amazon_url?: string | null;
}): ProvenanceTier {
  const hasPrice = c.price_raw != null || (!!c.price && c.price !== "—");
  const url = c.source_url ?? c.amazon_url ?? null;
  return {
    tier: "Rainforest product API",
    attempted: true,
    outcome: hasPrice ? "success" : "empty",
    itemCount: hasPrice ? 1 : 0,
    sourceUrls: url ? [url] : [],
  };
}
