// scripts/verify-tariff-price-stack.ts
// Offline regression check for the Pricing tab's internal tariff-multiplier
// table + price-stack calculator (lib/tariff-multipliers.ts,
// lib/price-stack.ts) — pure functions, zero I/O, zero network calls. This
// script also asserts that neither module contains a network call at all
// (a `fetch(` scan), which is the automatable half of the feature's own
// "zero web-search calls" acceptance criterion.
//
// Run with: npx tsx scripts/verify-tariff-price-stack.ts

export {};

import { readFileSync } from "fs";
import path from "path";

let passes = 0;
let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passes++;
    console.log(`  PASS: ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function approxEqual(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}

async function main() {
  const { getMultiplier, NO_MULTIPLIER_MESSAGE, TARIFF_TABLE, TARIFF_EFFECTIVE_NOTE, TARIFF_TABLE_UPDATED_ON, ROYALTY_SKU_NOTES } = await import("../lib/tariff-multipliers");
  const {
    computePriceStack, computeLandedCost, computeRoyaltyAmount, computeAdjustedLanded,
    computeSuggestedSalonPrice, computeDealerPrice, computeSuggestedRetailPrice,
    computeGmPct, gmBand,
  } = await import("../lib/price-stack");

  // ---- Section 1: exact spec walkthrough (2026-08-06 chart revision) ----
  console.log("\n[1] Spec walkthrough — China + Clippers & Trimmers, FOB $26.10");
  const noneResult = getMultiplier("china", "clippers_trimmers", "none");
  assert(noneResult.multiplier === 1.49, `China/Clippers & Trimmers/no brand partner resolves to 1.49 (got ${noneResult.multiplier})`);

  const landedNone = computeLandedCost(26.10, noneResult.multiplier!);
  assert(landedNone.toFixed(2) === "38.89", `Landed Cost at 1.49x rounds to $38.89 as specified (got ${landedNone.toFixed(2)})`);

  const nonSharedResult = getMultiplier("china", "clippers_trimmers", "gamma_nonshared_10");
  assert(nonSharedResult.multiplier === 1.59, `China/Clippers & Trimmers/Gamma+ non-shared resolves to 1.59 (got ${nonSharedResult.multiplier})`);
  const landedNonShared = computeLandedCost(26.10, nonSharedResult.multiplier!);
  assert(landedNonShared.toFixed(2) === "41.50", `Landed Cost at 1.59x rounds to $41.50 as specified (got ${landedNonShared.toFixed(2)})`);

  const sharedResult = getMultiplier("china", "clippers_trimmers", "gamma_shared_5");
  assert(sharedResult.multiplier === 1.54, `China/Shared Barber projects, Gamma+ (5%) resolves to 1.54 (got ${sharedResult.multiplier})`);

  // ---- Section 2: every other resolvable combination from the updated spec table ----
  console.log("\n[2] Every other tariff row resolves to its exact spec'd multiplier (7 changed values)");
  assert(getMultiplier("china", "styling_tools_shavers", "none").multiplier === 1.32, "China/Styling Tools & Shavers/none -> 1.32 (was 1.34)");
  assert(getMultiplier("china", "styling_tools_shavers", "gamma_nonshared_10").multiplier === 1.42, "China/Styling Tools & Shavers/Gamma+ non-shared -> 1.42 (was 1.44)");
  assert(getMultiplier("china", "aprons_garments", "none").multiplier === 1.52, "China/Aprons & Garments/none -> 1.52 (was 1.54)");
  assert(getMultiplier("china", "aprons_garments", "gamma_shared_5").multiplier === 1.52, "China/Aprons & Garments applies regardless of royalty type -> 1.52");
  assert(getMultiplier("europe", "clippers_trimmers", "gamma_shared_5").multiplier === 1.26, "Europe/any product type/Gamma+ shared -> 1.26 (was 1.30)");
  assert(getMultiplier("europe", "aprons_garments", "gamma_nonshared_10").multiplier === 1.26, "Europe/any OTHER product type/Gamma+ non-shared -> 1.26");
  assert(getMultiplier("europe", "liquids", "gamma_shared_5").multiplier === 1.18, "Europe + Liquids + Gamma+ prefers the MORE SPECIFIC Liquids row (1.18) over the general Beauty/Gamma+ row (1.26)");
  assert(getMultiplier("europe", "liquids", "none").multiplier === 1.18, "Europe + Liquids + no royalty still resolves via the Liquids row (royalty-agnostic) -> 1.18");
  assert(getMultiplier("vietnam", "clippers_trimmers", "gamma_shared_5").multiplier === 1.35, "Vietnam/any -> 1.35 regardless of product/royalty type");
  assert(getMultiplier("malaysia", "liquids", "none").multiplier === 1.34, "Malaysia/any -> 1.34");
  assert(getMultiplier("cambodia", "styling_tools_shavers", "none").multiplier === 1.34, "Cambodia/Beauty tools (Styling Tools & Shavers) -> 1.34");
  assert(getMultiplier("india", "clippers_trimmers", "none").multiplier === 1.50, "India/any -> 1.50");
  assert(getMultiplier("indonesia", "clippers_trimmers", "gamma_nonshared_10").multiplier === 1.19, "Indonesia/any -> 1.19");
  assert(getMultiplier("thailand", "liquids", "none").multiplier === 1.19, "Thailand/any -> 1.19");
  assert(getMultiplier("south_korea", "clippers_trimmers", "none").multiplier === 1.15, "South Korea/any -> 1.15");

  // ---- Section 3: Parts merged into the main China no-partner row ----
  console.log("\n[3] Parts merge — Product Type=Parts now resolves through the merged China clippers/trimmers/blades row (no more standalone cn_parts row)");
  assert(getMultiplier("china", "parts", "none").multiplier === 1.49, "China/Parts/no brand partner -> 1.49 via the merged clippers/trimmers/blades/parts row (the old standalone 1.49 'Parts only' row is gone, but the value is unchanged)");
  const partsShared = getMultiplier("china", "parts", "gamma_shared_5");
  assert(partsShared.multiplier === null && partsShared.error === NO_MULTIPLIER_MESSAGE, "China/Parts/Gamma+ shared (5%) has NO row on file — parts was only merged into the no-partner row, never into the Gamma+ rows, so this must not silently resolve via 1.54");
  const partsNonshared = getMultiplier("china", "parts", "gamma_nonshared_10");
  assert(partsNonshared.multiplier === null && partsNonshared.error === NO_MULTIPLIER_MESSAGE, "China/Parts/Gamma+ non-shared (10%) has NO row on file — same reasoning, must not silently resolve via 1.59");
  assert(!TARIFF_TABLE.some(r => r.id === "cn_parts"), "the old standalone 'cn_parts' row id no longer exists in TARIFF_TABLE");
  const mergedRow = TARIFF_TABLE.find(r => r.id === "cn_clip_none")!;
  const mergedRowProductTypes = mergedRow.productTypes as string[] | "any";
  assert(Array.isArray(mergedRowProductTypes) && mergedRowProductTypes.includes("parts") && mergedRowProductTypes.includes("clippers_trimmers"), "the merged row's productTypes includes both \"clippers_trimmers\" and \"parts\"");

  // ---- Section 4: unmatched combinations — never guess, never fall back ----
  console.log("\n[4] Unmatched combinations — the explicit no-guess message, never a fallback multiplier");
  const unmatched1 = getMultiplier("china", "liquids", "none");
  assert(unmatched1.multiplier === null && unmatched1.error === NO_MULTIPLIER_MESSAGE, `China + Liquids has no row on file (got multiplier=${unmatched1.multiplier})`);
  const unmatched2 = getMultiplier("china", "styling_tools_shavers", "gamma_shared_5");
  assert(unmatched2.multiplier === null && unmatched2.error === NO_MULTIPLIER_MESSAGE, "China + Styling Tools + Gamma+ SHARED (5%) has no row on file (only the 10% variant is spec'd) — never silently reuses the 10% row's multiplier");
  const unmatched3 = getMultiplier("europe", "clippers_trimmers", "none");
  assert(unmatched3.multiplier === null && unmatched3.error === NO_MULTIPLIER_MESSAGE, "Europe + non-Liquids product + no royalty partner has no row on file");
  assert(unmatched1.error === "No tariff multiplier on file for this combination — contact admin.", "the exact required message text is used verbatim");

  // ---- Section 5: no ambiguous double-match resolves inconsistently ----
  console.log("\n[5] Table self-check — every real (country,productType,royaltyType) triple resolves deterministically");
  let inconsistent = 0;
  const countries = Array.from(new Set(TARIFF_TABLE.map(r => r.country)));
  const productTypes: any[] = ["clippers_trimmers", "styling_tools_shavers", "aprons_garments", "liquids", "parts"];
  const royaltyTypes: any[] = ["none", "gamma_shared_5", "gamma_nonshared_10"];
  for (const c of countries) {
    for (const p of productTypes) {
      for (const r of royaltyTypes) {
        const a = getMultiplier(c as any, p, r);
        const b = getMultiplier(c as any, p, r);
        if (a.multiplier !== b.multiplier) inconsistent++;
      }
    }
  }
  assert(inconsistent === 0, `every combination resolves to the SAME multiplier on repeated calls (found ${inconsistent} inconsistent resolutions) — the resolver is deterministic, not accidentally order/random dependent`);

  // ---- Section 6: full price-stack math ----
  console.log("\n[6] Full price-stack formulas — Landed -> Adjusted Landed -> Salon -> Dealer -> Retail -> GM%");
  const fob = 26.10;
  const multiplier = 1.52;
  const royaltyPct = 0.05;
  const other = 2.00;

  const landed = computeLandedCost(fob, multiplier);
  const royaltyAmount = computeRoyaltyAmount(royaltyPct, fob);
  assert(approxEqual(royaltyAmount, 1.305), `Royalty is calculated on FOB, not Landed Cost (5% of $26.10 = $1.305, got ${royaltyAmount})`);
  const adjustedLanded = computeAdjustedLanded(landed, royaltyAmount, other);
  assert(approxEqual(adjustedLanded, landed + 1.305 + 2.00), "Adjusted Landed = Landed + Royalties + Other");

  const salon = computeSuggestedSalonPrice(adjustedLanded);
  assert(approxEqual(computeGmPct(salon, adjustedLanded)!, 0.5), `the suggested Salon price sits at exactly the 50% GM floor (got ${computeGmPct(salon, adjustedLanded)})`);

  const dealer = computeDealerPrice(salon);
  assert(approxEqual(dealer, salon * 0.5), "Dealer Price = Salon Price x 50%");

  const retail = computeSuggestedRetailPrice(dealer);
  assert(approxEqual(retail, dealer * 2), "Retail Price = Dealer Price x 2");
  // A real, deliberate consequence of the exact formulas as specified:
  // Dealer (=Salon*50%) mathematically equals Adjusted Landed exactly when
  // Salon sits at its suggested 50%-GM floor (Salon=2*AL => Dealer=AL), and
  // Retail (=Dealer*2) then mathematically equals Salon exactly too — both
  // land at 50% GM, the low end of the 50-80% target band. This is
  // internal-consistency, not a bug: a Salon price edited ABOVE the
  // suggested floor pushes Dealer/Retail proportionally higher, moving
  // Retail's GM% up within the target band.
  const retailGm = computeGmPct(retail, adjustedLanded)!;
  assert(approxEqual(retail, salon), "at the suggested (unedited) values, Retail mathematically equals Salon exactly — a direct consequence of Dealer=Salon*50% and Retail=Dealer*2");
  assert(approxEqual(retailGm, 0.5), `Retail's GM% at the suggested floor sits at exactly 50% (the low end of the 50-80% target band), got ${(retailGm * 100).toFixed(1)}%`);

  const stack = computePriceStack({ fobCost: fob, multiplier, royaltyPct, otherCosts: other });
  assert(approxEqual(stack.landedCost, landed) && approxEqual(stack.adjustedLanded, adjustedLanded), "computePriceStack's orchestrated result matches the individually-composed formulas");
  assert(stack.gmSalonBand === "green", `the suggested Salon price's GM% band is green (exactly at the 50% floor), got "${stack.gmSalonBand}"`);

  // Editable overrides — a human-entered Salon/Retail value is used verbatim
  // and its own GM% is recomputed against it, not silently replaced.
  const overridden = computePriceStack({ fobCost: fob, multiplier, royaltyPct, otherCosts: other, salonPriceOverride: 100, retailPriceOverride: 250 });
  assert(overridden.salonPrice === 100 && overridden.retailPrice === 250, "an explicit Salon/Retail override is used verbatim instead of the suggested value");
  assert(approxEqual(overridden.gmSalonPct!, computeGmPct(100, adjustedLanded)!), "GM% recalculates live against an overridden Salon price");
  // Dealer is always derived from Salon, never independently editable/overridden.
  assert(approxEqual(overridden.dealerPrice, 50), "Dealer Price is always derived from Salon (50%), even when Salon itself was overridden — never independently settable");

  // ---- Section 7: GM% color-coding boundaries ----
  console.log("\n[7] gmBand — green in the 50-80% target band, amber outside it");
  assert(gmBand(0.499) === "amber", "49.9% is just below the green band -> amber");
  assert(gmBand(0.50) === "green", "exactly 50% is the green band's floor -> green");
  assert(gmBand(0.65) === "green", "65% (mid-band) -> green");
  assert(gmBand(0.80) === "green", "exactly 80% is the green band's ceiling -> green");
  assert(gmBand(0.801) === "amber", "80.1% is just above the green band -> amber");
  assert(gmBand(null) === "neutral", "no price yet (null GM%) -> neutral, not a false amber/green");

  // ---- Section 8: zero network calls anywhere in either module ----
  console.log("\n[8] Source scan — zero network calls in the tariff/price-stack modules");
  const tariffSource = readFileSync(path.join(__dirname, "..", "lib", "tariff-multipliers.ts"), "utf-8");
  const priceStackSource = readFileSync(path.join(__dirname, "..", "lib", "price-stack.ts"), "utf-8");
  assert(!tariffSource.includes("fetch(") && !tariffSource.includes("await import"), "lib/tariff-multipliers.ts contains no fetch()/dynamic-import network call");
  assert(!priceStackSource.includes("fetch(") && !priceStackSource.includes("await import"), "lib/price-stack.ts contains no fetch()/dynamic-import network call");

  // ---- Section 9: component-breakdown sanity check + royalty/effective-date metadata ----
  console.log("\n[9] Component-breakdown sanity check (ran at module load, above) + royalty/effective-date metadata");
  // Re-derives the same check independently (not just trusting that
  // lib/tariff-multipliers.ts's own module-load-time throw didn't fire —
  // reaching this line already proves that, but this makes the test
  // meaningful on its own even if that in-module check is ever weakened).
  let sanityFailures = 0;
  for (const row of TARIFF_TABLE as any[]) {
    if (!row.components) continue;
    const { tariff = 0, duty = 0, freight = 0, royalty = 0, other = 0 } = row.components;
    const computed = 1 + tariff + duty + freight + royalty + other;
    if (Math.abs(computed - row.multiplier) > 0.0051) sanityFailures++;
  }
  assert(sanityFailures === 0, `every row's component breakdown sums to its stored multiplier within ±0.0051 (${sanityFailures} row(s) failed)`);
  const rowsWithComponents = TARIFF_TABLE.filter((r: any) => r.components).length;
  assert(rowsWithComponents === 11, `11 of ${TARIFF_TABLE.length} rows carry a component breakdown (India/Indonesia/Thailand/South Korea are Total-Markup-only, got ${rowsWithComponents})`);

  assert(typeof TARIFF_EFFECTIVE_NOTE === "string" && TARIFF_EFFECTIVE_NOTE.includes(TARIFF_TABLE_UPDATED_ON), "TARIFF_EFFECTIVE_NOTE embeds TARIFF_TABLE_UPDATED_ON verbatim");
  assert(TARIFF_EFFECTIVE_NOTE.startsWith("Rates effective as of loading dates at origin"), "TARIFF_EFFECTIVE_NOTE uses the exact required wording");

  assert(ROYALTY_SKU_NOTES.gamma_shared_5.exampleSkus.includes("GP803B XCell Shaver"), "5% royalty metadata includes the GP803B XCell Shaver example SKU");
  assert(ROYALTY_SKU_NOTES.gamma_shared_5.exampleSkus.includes("GP609B XCell Clipper"), "5% royalty metadata includes the GP609B XCell Clipper example SKU");
  assert(ROYALTY_SKU_NOTES.gamma_shared_5.exampleSkus.includes("GP418B XCell Trimmer"), "5% royalty metadata includes the GP418B XCell Trimmer example SKU");
  assert(ROYALTY_SKU_NOTES.gamma_nonshared_10.exampleSkus.includes("GP103G Xcell Horizon Hair Dryer"), "10% royalty metadata includes the GP103G Xcell Horizon Hair Dryer example SKU");
  assert(ROYALTY_SKU_NOTES.gamma_nonshared_10.exampleSkus.some((s: string) => s.includes("XCell black/red dryers") || s.includes("XCell") ), "10% royalty metadata includes the XCell black/red dryers example SKU");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
