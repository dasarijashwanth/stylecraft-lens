// Price-band math for anchoring competitor discovery to the user's actual
// target price — a $25 product must never be accepted as a competitor to a
// $260 product. Plain TS, no server-only imports (used from
// components/analyze/CompetitorCard.tsx as well as lib/analysisEngine.ts).
import { parsePriceToNumber } from "./pricing-analysis";

export { parsePriceToNumber };

export type CompetitorTier = "legacy" | "emerging";

export interface PriceBand {
  min: number;
  max: number;
  widenStep: number;
  isWidened: boolean;
}

// Legacy's band is symmetric at every widen step. Emerging's LOWER bound is
// already wider at step 0 ("same band preferred, may extend to -40%" — value
// challengers are legitimately relevant at a lower price point than an
// established brand), stepping further only on widen. Both floors bottom out
// at 50% of target — enforced again explicitly in computePriceBand below, not
// just by this table, so the "never below 50%" rule holds even if these
// tables are ever tuned independently.
const LOWER_PCT_BY_STEP: Record<CompetitorTier, number[]> = {
  legacy: [0.30, 0.40, 0.50],
  emerging: [0.40, 0.45, 0.50],
};
const UPPER_PCT_BY_STEP: Record<CompetitorTier, number[]> = {
  legacy: [0.30, 0.40, 0.50],
  emerging: [0.30, 0.40, 0.50],
};

// widenStep: 0 = primary band (±30%), 1 = ±40%, 2 = ±50% (clamped).
export function computePriceBand(targetPrice: number, tier: CompetitorTier, widenStep = 0): PriceBand {
  const step = Math.min(2, Math.max(0, widenStep));
  const lowerPct = LOWER_PCT_BY_STEP[tier][step];
  const upperPct = UPPER_PCT_BY_STEP[tier][step];
  const min = Math.max(targetPrice * 0.5, targetPrice * (1 - lowerPct));
  const max = targetPrice * (1 + upperPct);
  return { min, max, widenStep: step, isWidened: step > 0 };
}

export function isWithinBand(price: number, band: PriceBand): boolean {
  return price >= band.min && price <= band.max;
}

export function deriveTierKeyword(targetPrice: number): "budget" | "mid-range" | "professional" | "premium" {
  if (targetPrice <= 50) return "budget";
  if (targetPrice <= 120) return "mid-range";
  if (targetPrice <= 250) return "professional";
  return "premium";
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

// "Included at $149 — below your price band (limited same-tier competition
// found)" — the exact phrasing the widening rule requires so an out-of-band
// pick is never silently presented as if it were a normal in-band match.
export function buildOutOfBandLabel(price: number, primaryBand: PriceBand): string {
  const direction = price < primaryBand.min ? "below" : "above";
  return `Included at ${fmtPrice(price)} — ${direction} your price band (limited same-tier competition found)`;
}
