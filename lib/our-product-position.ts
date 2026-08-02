// lib/our-product-position.ts
// Where OUR product sits within OUR OWN catalog lineup — needed only for
// indie-brand relative price scoring (Part 4): "our flagship should match
// their flagship, even at a different absolute price." Pure, synchronous
// (no DB import — the caller fetches listCatalogProducts() once, same
// "never module-level state, always an explicit param" convention
// motorFamilies/toolTypes/correctionSignals already follow in
// lib/analysisEngine.ts). Percentile math reuses
// lib/indie-brand-lineup.ts's computePercentileInLineup rather than a
// second copy of the same min-max formula.
import type { CatalogProductRow } from "./db/catalog-products";
import { computePercentileInLineup, LineupProduct } from "./indie-brand-lineup";

export type LineupTier = "flagship" | "mid" | "entry";

export interface OurLineupPosition {
  percentile: number; // 0 (cheapest in its tool type) .. 1 (most expensive)
  tier: LineupTier;
  lineupSize: number;
  matchedProduct: { id: string; name: string; price: number } | null;
}

function normalizeName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchCatalogProductByName(productName: string, catalogProducts: CatalogProductRow[]): CatalogProductRow | null {
  if (!productName) return null;
  const target = normalizeName(productName);
  return (
    catalogProducts.find(p => {
      const name = normalizeName(p.name);
      return target === name || target.includes(name) || name.includes(target);
    }) || null
  );
}

function tierFromPercentile(percentile: number): LineupTier {
  if (percentile >= 0.75) return "flagship";
  if (percentile >= 0.35) return "mid";
  return "entry";
}

// Resolution order: (1) an explicit catalogProductId (set when the analyze
// form's catalog picker was used) is an authoritative id lookup; (2)
// otherwise fuzzy-match productName against the passed-in catalog (covers
// analyses created before catalogProductId existed, or a manual entry that
// happens to match a catalog product's name); (3) otherwise null — the
// caller pauses-and-asks a one-field question ("premium flagship / mid /
// entry model?") rather than guessing. Sibling grouping is by the real
// tool_type column (not the old catalog's loose category string), matching
// what the discovery pipeline itself isolates on.
export function resolveOurLineupTier(
  productName: string,
  catalogProducts: CatalogProductRow[],
  catalogProductId?: string | null
): OurLineupPosition | null {
  const matched = (catalogProductId ? catalogProducts.find(p => p.id === catalogProductId) : null)
    ?? matchCatalogProductByName(productName, catalogProducts);
  if (!matched || matched.target_price === null) return null;

  const siblings: LineupProduct[] = catalogProducts
    .filter(p => p.tool_type === matched.tool_type && p.target_price !== null)
    .map(p => ({ asin: p.id, title: p.name, price_raw: p.target_price as number }));

  if (siblings.length < 2) {
    // No siblings to rank against — treat as its own full range rather
    // than guessing a tier from nothing.
    return { percentile: 1, tier: "flagship", lineupSize: siblings.length, matchedProduct: { id: matched.id, name: matched.name, price: matched.target_price } };
  }

  const percentile = computePercentileInLineup(matched.target_price, siblings) ?? 0.5;

  return {
    percentile,
    tier: tierFromPercentile(percentile),
    lineupSize: siblings.length,
    matchedProduct: { id: matched.id, name: matched.name, price: matched.target_price },
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
