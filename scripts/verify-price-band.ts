// scripts/verify-price-band.ts
// Offline regression check for Phase 2's price-anchored competitor
// discovery — pure band math (lib/price-band.ts) plus the server-side
// filter/gate functions (lib/analysisEngine.ts's
// filterCandidatesByCategoryAndIdentity / applyPriceBandGate), all against
// synthetic candidates. No live Rainforest/OpenAI/Gemini call — no
// .env.local is loaded, so every provider resolves unconfigured and the
// gate's own logic (pure, synchronous) is all that's under test.
//
// Run with: npx tsx scripts/verify-price-band.ts

export {};

let failures = 0;
let passes = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passes++;
    console.log(`  PASS: ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function makeIdentity(category: string, subcategory: string, productName = "Test Product"): any {
  return {
    productName,
    brand: null,
    category,
    subcategory,
    whatItIs: subcategory,
    keyAttributes: [],
    targetUser: "both",
    priceObserved: null,
    confidence: "high",
    evidence: [],
    identityStatus: "confirmed",
  };
}

async function main() {
  const { computePriceBand, isWithinBand, deriveTierKeyword, buildOutOfBandLabel, parsePriceToNumber } = await import("../lib/price-band");
  const { filterCandidatesByCategoryAndIdentity, applyPriceBandGate } = await import("../lib/analysisEngine");

  // ---- Section 1: pure band math ----
  console.log("\n[1] computePriceBand / isWithinBand / deriveTierKeyword");

  const legacyBand0 = computePriceBand(259.95, "legacy", 0);
  assert(Math.abs(legacyBand0.min - 259.95 * 0.7) < 0.01, "legacy step-0 lower bound is target * 0.7 (-30%)");
  assert(Math.abs(legacyBand0.max - 259.95 * 1.3) < 0.01, "legacy step-0 upper bound is target * 1.3 (+30%)");
  assert(legacyBand0.isWidened === false, "step 0 is not flagged as widened");

  const legacyBand2 = computePriceBand(259.95, "legacy", 2);
  assert(Math.abs(legacyBand2.min - 259.95 * 0.5) < 0.01, "legacy step-2 (widest) lower bound is exactly 50% of target");
  assert(legacyBand2.isWidened === true, "step 2 is flagged as widened");

  const emergingBand0 = computePriceBand(259.95, "emerging", 0);
  assert(Math.abs(emergingBand0.min - 259.95 * 0.6) < 0.01, "emerging step-0 lower bound already extends to -40% (wider than legacy's -30%)");

  // Never below 50% of target, even if a widen-step table were misconfigured to go further.
  const neverBelowFloor = computePriceBand(100, "emerging", 2);
  assert(neverBelowFloor.min >= 50 - 0.01, "band lower bound never drops below 50% of target price");

  assert(isWithinBand(250, legacyBand0) === true, "$250 is within the $259.95 legacy primary band");
  assert(isWithinBand(25, legacyBand0) === false, "$25 is NOT within the $259.95 legacy primary band");
  assert(isWithinBand(25, legacyBand2) === false, "$25 is NOT within even the widest legacy band — the exact reported bug scenario");

  assert(deriveTierKeyword(30) === "budget", "deriveTierKeyword(30) === budget");
  assert(deriveTierKeyword(80) === "mid-range", "deriveTierKeyword(80) === mid-range");
  assert(deriveTierKeyword(200) === "professional", "deriveTierKeyword(200) === professional");
  assert(deriveTierKeyword(300) === "premium", "deriveTierKeyword(300) === premium");

  assert(parsePriceToNumber("$259.95") === 259.95, `parsePriceToNumber("$259.95") === 259.95`);
  assert(parsePriceToNumber("$1,299.00") === 1299, `parsePriceToNumber("$1,299.00") === 1299 (comma-tolerant)`);

  const label = buildOutOfBandLabel(149, legacyBand0);
  assert(label.includes("$149.00") && label.includes("below your price band"), `buildOutOfBandLabel produces the spec's exact phrasing: "${label}"`);

  // ---- Section 2: filterCandidatesByCategoryAndIdentity ----
  console.log("\n[2] filterCandidatesByCategoryAndIdentity — category/self-name/ASIN cleanup");

  const identity = makeIdentity("hair styling tools", "hair dryer", "Acme Turbo Dryer 3000");
  const rawCandidates = [
    { name: "Dyson Supersonic Hair Dryer", top_feature_summary: "fast drying", asin: "B0189O6FES", amazon_url: "https://www.amazon.com/dp/B0189O6FES", price: "$429.99" },
    { name: "Acme Turbo Dryer 3000 Pro Clone", top_feature_summary: "hair dryer", asin: "BXXXXXXXXX", amazon_url: "https://www.amazon.com/dp/BXXXXXXXXX", price: "$50.00" }, // named after own product — must be rejected
    { name: "Some Random Blender", top_feature_summary: "kitchen appliance", asin: "B0000000AA", price: "$40.00" }, // wrong category — must be rejected
    { name: "Conair InfinitiPRO Dryer", top_feature_summary: "hair dryer", asin: "B000E0L3C0", amazon_url: "https://www.amazon.com/dp/B000E0L3C0", price: "$39.99" },
  ];
  const filtered = filterCandidatesByCategoryAndIdentity(rawCandidates, "legacy", identity);
  assert(filtered.length === 2, `filter kept exactly the 2 real, correctly-categorized, non-self-named candidates (got ${filtered.length})`);
  assert(filtered.every((c: any) => c.name !== "Acme Turbo Dryer 3000 Pro Clone"), "candidate named after the analyzed product itself was rejected");
  assert(filtered.every((c: any) => c.name !== "Some Random Blender"), "wrong-category candidate was rejected");
  assert(filtered.every((c: any) => "ai_claimed_price" in c), "every surviving candidate preserves its AI-claimed price for the price gate to fall back on");

  // ---- Section 3: applyPriceBandGate — synthetic candidates ----
  console.log("\n[3] applyPriceBandGate — hard price filtering + widening");

  const targetPriceRaw = 259.95;
  const syntheticCandidates = [
    { name: "In-Band A", tier: "legacy", price_raw: 240, ai_claimed_price: "$240.00" },
    { name: "In-Band B", tier: "legacy", price_raw: 270, ai_claimed_price: "$270.00" },
    { name: "In-Band C", tier: "legacy", price_raw: 300, ai_claimed_price: "$300.00" },
    { name: "Way Too Cheap", tier: "legacy", price_raw: 25, ai_claimed_price: "$25.00" },
    { name: "No Live Price, Good AI Claim", tier: "legacy", price_raw: null, ai_claimed_price: "$260.00" },
    { name: "No Price At All", tier: "legacy", price_raw: null, ai_claimed_price: null },
  ];
  const gated = applyPriceBandGate(syntheticCandidates, targetPriceRaw, "legacy", identity, 5);
  assert(gated.some((c: any) => c.name === "In-Band A"), "in-band candidate A accepted");
  assert(gated.some((c: any) => c.name === "In-Band B"), "in-band candidate B accepted");
  assert(gated.some((c: any) => c.name === "In-Band C"), "in-band candidate C accepted");
  assert(!gated.some((c: any) => c.name === "Way Too Cheap"), "a $25 candidate against a $260 target is REJECTED — the exact reported bug");
  assert(gated.some((c: any) => c.name === "No Live Price, Good AI Claim"), "a candidate with no live Rainforest price falls back to its AI-claimed price for gating");
  assert(!gated.some((c: any) => c.name === "No Price At All"), "a candidate with no resolvable price at all (neither live nor AI-claimed) is rejected");
  assert(gated.every((c: any) => !c.out_of_band), "no in-band-at-step-0 candidate is incorrectly tagged out_of_band");

  // ---- Section 4: widening kicks in only when < limit in-band candidates exist ----
  console.log("\n[4] Widening rule — only widens when fewer than `limit` in-band candidates are found");

  const sparseCandidates = [
    { name: "Only In-Band One", tier: "legacy", price_raw: 250, ai_claimed_price: "$250.00" },
    { name: "Widened Pick (step 1)", tier: "legacy", price_raw: 160, ai_claimed_price: "$160.00" }, // outside ±30%, inside ±40%
  ];
  const gatedSparse = applyPriceBandGate(sparseCandidates, targetPriceRaw, "legacy", identity, 5);
  const widenedPick = gatedSparse.find((c: any) => c.name === "Widened Pick (step 1)");
  assert(!!widenedPick, "an otherwise-rejected candidate is accepted once widening reaches its price");
  assert(widenedPick?.out_of_band === true, "a widened-in pick is tagged out_of_band: true");
  assert(typeof widenedPick?.out_of_band_reason === "string" && widenedPick.out_of_band_reason.includes("below your price band"), "the out_of_band_reason uses the spec's exact phrasing");

  // ---- Section 5: the EXACT reported bug scenario — real curated fallback data ----
  console.log("\n[5] End-to-end: $259.95 target against real curated hair-dryer fallback data");

  const fallbackScenario = applyPriceBandGate([], 259.95, "legacy", makeIdentity("hair styling", "hair dryer"), 5);
  const names = fallbackScenario.map((c: any) => c.name);
  assert(!names.some((n: string) => n.includes("Conair")), "Conair ($39.99) correctly EXCLUDED even at the widest band — the exact bug scenario");
  assert(!names.some((n: string) => n.includes("Revlon")), "Revlon ($39.88) correctly EXCLUDED even at the widest band");
  assert(!names.some((n: string) => n.includes("Dyson")), "Dyson ($429.99) correctly EXCLUDED — above even the widest band");
  assert(names.some((n: string) => n.includes("Parlux")), "Parlux ($230, in-band) correctly INCLUDED as the one qualifying fallback competitor");
  assert(fallbackScenario.length === 1, `exactly 1 fallback competitor qualifies at this price point (got ${fallbackScenario.length}) — fewer real competitors is correct, inventing fake ones is not`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
