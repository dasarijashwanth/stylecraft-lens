// lib/our-product-position.ts
// Where OUR product sits within OUR OWN catalog lineup — needed only for
// indie-brand relative price scoring (Part 4): "our flagship should match
// their flagship, even at a different absolute price." Pure, synchronous,
// self-contained (deliberately re-implements the same normalize/match
// logic as lib/db/reports.ts's private matchCatalogProduct rather than
// importing that file, which pulls in unrelated Supabase/report-building
// dependencies this pure lib has no reason to depend on).
import { STYLECRAFT_PRODUCTS } from "./stylecraft-products";

export type LineupTier = "flagship" | "mid" | "entry";

export interface OurLineupPosition {
  percentile: number; // 0 (cheapest in its category) .. 1 (most expensive)
  tier: LineupTier;
  lineupSize: number;
  matchedProduct: { id: string; name: string; price: number } | null;
}

function normalizeName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchStyleCraftProduct(productName: string) {
  if (!productName) return null;
  const target = normalizeName(productName);
  return (
    STYLECRAFT_PRODUCTS.find(p => {
      const name = normalizeName(p.name);
      const short = normalizeName(p.shortName);
      return target === name || target === short || target.includes(short) || short.includes(target);
    }) || null
  );
}

function tierFromPercentile(percentile: number): LineupTier {
  if (percentile >= 0.75) return "flagship";
  if (percentile >= 0.35) return "mid";
  return "entry";
}

// Returns null when the input product isn't a recognized StyleCraft
// catalog entry (a custom/unreleased product) — the caller pauses-and-asks
// a one-field question ("premium flagship / mid / entry model?") rather
// than guessing.
export function resolveOurLineupTier(productName: string): OurLineupPosition | null {
  const matched = matchStyleCraftProduct(productName);
  if (!matched) return null;

  const siblingPrices = STYLECRAFT_PRODUCTS.filter(p => p.category === matched.category)
    .map(p => p.price)
    .sort((a, b) => a - b);

  if (siblingPrices.length < 2) {
    // No siblings to rank against — treat as its own full range rather
    // than guessing a tier from nothing.
    return { percentile: 1, tier: "flagship", lineupSize: siblingPrices.length, matchedProduct: { id: matched.id, name: matched.name, price: matched.price } };
  }

  const min = siblingPrices[0];
  const max = siblingPrices[siblingPrices.length - 1];
  const percentile = max === min ? 0.5 : (matched.price - min) / (max - min);

  return {
    percentile,
    tier: tierFromPercentile(percentile),
    lineupSize: siblingPrices.length,
    matchedProduct: { id: matched.id, name: matched.name, price: matched.price },
  };
}

// For the pause-and-ask path — maps a user-selected tier straight to a
// representative percentile, so downstream relative-price scoring never
// needs to special-case "we have no lineup at all, but the user told us."
export function percentileForManualTier(tier: LineupTier): number {
  if (tier === "flagship") return 0.9;
  if (tier === "entry") return 0.1;
  return 0.5;
}
