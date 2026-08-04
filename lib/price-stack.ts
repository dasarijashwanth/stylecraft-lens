// lib/price-stack.ts
// Pure, deterministic price-stack math for the Pricing tab's landed-cost
// calculator — zero I/O, zero network calls, every function synchronous.
// Royalty is calculated on FOB cost (not Landed Cost) per an explicit
// product decision — royalties are a contractual percentage of the
// manufacturing cost, independent of whatever the country tariff
// multiplier happens to be.

export type GmBand = "green" | "amber" | "neutral";

// Green band matches Retail's explicit 50-80% GM% target in the spec.
// Salon's "≥50% margin minimum" is the floor of this same band; Dealer has
// no explicit band in the spec — defaulted to the same 50-80% rule for
// consistency across all three tiers (a one-line change if a different
// Dealer band is wanted later).
const GM_BAND_MIN = 0.50;
const GM_BAND_MAX = 0.80;

export function computeLandedCost(fob: number, multiplier: number): number {
  return fob * multiplier;
}

export function computeRoyaltyAmount(royaltyPct: number, fob: number): number {
  return royaltyPct * fob;
}

export function computeAdjustedLanded(landedCost: number, royaltyAmount: number, other: number): number {
  return landedCost + royaltyAmount + other;
}

// Algebraic inverse of GM% = (Price - Cost) / Price at the 50% floor:
// 0.50 = (P - C) / P  =>  P = C / (1 - 0.50) = 2C.
export function computeSuggestedSalonPrice(adjustedLanded: number): number {
  return adjustedLanded * 2;
}

export function computeDealerPrice(salonPrice: number): number {
  return salonPrice * 0.5;
}

export function computeSuggestedRetailPrice(dealerPrice: number): number {
  return dealerPrice * 2;
}

export function computeGmPct(price: number, adjustedLanded: number): number | null {
  if (!price) return null;
  return (price - adjustedLanded) / price;
}

export function gmBand(gmPct: number | null): GmBand {
  if (gmPct == null) return "neutral";
  return gmPct >= GM_BAND_MIN && gmPct <= GM_BAND_MAX ? "green" : "amber";
}

export interface PriceStackInputs {
  fobCost: number;
  multiplier: number;
  royaltyPct: number;
  otherCosts: number;
  // Editable overrides — when a human has typed their own Salon/Retail
  // value, that value is used verbatim (and its own GM% recomputed against
  // it) instead of the suggested one.
  salonPriceOverride?: number | null;
  retailPriceOverride?: number | null;
}

export interface PriceStackResult {
  landedCost: number;
  royaltyAmount: number;
  adjustedLanded: number;
  salonPrice: number;
  dealerPrice: number;
  retailPrice: number;
  gmSalonPct: number | null;
  gmDealerPct: number | null;
  gmRetailPct: number | null;
  gmSalonBand: GmBand;
  gmDealerBand: GmBand;
  gmRetailBand: GmBand;
}

// Orchestrates the full stack in one call — rounding is left to the
// caller/display layer (toFixed(2) at render time), so chained
// intermediate values never compound rounding error.
export function computePriceStack(inputs: PriceStackInputs): PriceStackResult {
  const landedCost = computeLandedCost(inputs.fobCost, inputs.multiplier);
  const royaltyAmount = computeRoyaltyAmount(inputs.royaltyPct, inputs.fobCost);
  const adjustedLanded = computeAdjustedLanded(landedCost, royaltyAmount, inputs.otherCosts);

  const salonPrice = inputs.salonPriceOverride ?? computeSuggestedSalonPrice(adjustedLanded);
  const dealerPrice = computeDealerPrice(salonPrice);
  const retailPrice = inputs.retailPriceOverride ?? computeSuggestedRetailPrice(dealerPrice);

  const gmSalonPct = computeGmPct(salonPrice, adjustedLanded);
  const gmDealerPct = computeGmPct(dealerPrice, adjustedLanded);
  const gmRetailPct = computeGmPct(retailPrice, adjustedLanded);

  return {
    landedCost,
    royaltyAmount,
    adjustedLanded,
    salonPrice,
    dealerPrice,
    retailPrice,
    gmSalonPct,
    gmDealerPct,
    gmRetailPct,
    gmSalonBand: gmBand(gmSalonPct),
    gmDealerBand: gmBand(gmDealerPct),
    gmRetailBand: gmBand(gmRetailPct),
  };
}
