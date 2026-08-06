// scripts/verify-related-products-scoring.ts
// Offline regression check for the Related Products feature's scoring/
// discovery-context additions (lib/competitor-scoring.ts's
// computeRelatedProductSimilarity + computeFeatureScore's new bonus param,
// lib/analysisEngine.ts's buildRelatedProductsDiscoveryContext/
// buildRelatedProductSeeds/selectByCompositeScore wiring) — no live
// OpenAI/Gemini/Rainforest calls, pure functions + selectByCompositeScore
// exercised directly with synthetic pools, same technique
// scripts/verify-nearest-similar-fallback.ts already uses.
//
// Run with: npx tsx scripts/verify-related-products-scoring.ts

export {};

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.log(`FAIL: ${message}`);
    failed++;
  }
}

function approx(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

const CLIPPER_IDENTITY: any = {
  productName: "Test Brushless Clipper 5000",
  brand: "TestBrand",
  category: "Clippers",
  subcategory: "Professional Clipper",
  whatItIs: "A cordless professional clipper",
  keyAttributes: ["brushless motor"],
  targetUser: "both",
  priceObserved: { value: 300, currency: "USD", source: "form" },
  confidence: "high",
  evidence: [],
  identityStatus: "verified",
  toolType: "clipper",
};

function makeToolTypesFixture(): any[] {
  const now = new Date().toISOString();
  return [{ id: "ttype_clipper", type_key: "clipper", label: "Clipper", aliases: ["clipper"], family: "clipper_trimmer_shaver", primary_criterion: "motor", enabled: true, custom: false, sort_order: 0, created_at: now, updated_at: now }];
}

async function main() {
  const {
    computeFeatureScore, computeRelatedProductSimilarity, computeCompositeScore, DEFAULT_WEIGHTS,
  } = await import("../lib/competitor-scoring");
  const {
    selectByCompositeScore, filterCandidatesByCategoryAndIdentity,
    buildRelatedProductsDiscoveryContext, buildRelatedProductSeeds,
  } = await import("../lib/analysisEngine");

  console.log("\n[1] computeRelatedProductSimilarity — fraction-of-3-true, max across multiple related products");
  const oursSpecs = { rpm: 7500, cordless: true };
  const relatedFull = [{ motorFamilyKey: "brushless", priceRaw: 300, specs: { rpm: 7500, cordless: true } }];
  assert(computeRelatedProductSimilarity({ motorFamilyKey: "brushless", priceRaw: 300 }, oursSpecs, relatedFull) === 1, "same motor family + same price + full feature overlap -> similarity 1");
  const noOverlapSpecs = { rpm: 2000, cordless: false };
  assert(computeRelatedProductSimilarity({ motorFamilyKey: "rotary", priceRaw: 900 }, noOverlapSpecs, relatedFull) === 0, "different motor family + wildly different price + no feature overlap -> similarity 0");
  const partialCandidate = computeRelatedProductSimilarity({ motorFamilyKey: "brushless", priceRaw: 900 }, oursSpecs, relatedFull);
  assert(approx(partialCandidate, 2 / 3), `same motor family + full feature overlap but far-off price -> 2/3 (got ${partialCandidate})`);
  assert(computeRelatedProductSimilarity({ motorFamilyKey: "brushless" }, oursSpecs, []) === 0, "no related products supplied -> similarity 0, never null/NaN");

  const twoRelated = [
    { motorFamilyKey: "rotary", priceRaw: 900, specs: { rpm: 3000 } },
    { motorFamilyKey: "brushless", priceRaw: 300, specs: { rpm: 7500, cordless: true } },
  ];
  const bestOfTwo = computeRelatedProductSimilarity({ motorFamilyKey: "brushless", priceRaw: 300 }, oursSpecs, twoRelated);
  assert(bestOfTwo === 1, "similarity is the MAX across all related products, not the first or an average");

  console.log("\n[2] computeFeatureScore's additive bonus — purely additive, capped at 1.0, backward-compatible");
  const baseScore = computeFeatureScore({ rpm: 7500, cordless: true }, { rpm: 7400, cordless: true });
  assert(baseScore === 1, "sanity: base structural score with no bonus/differentiator args is unchanged (1.0)");
  assert(computeFeatureScore({ rpm: 7500, cordless: true }, { rpm: 7400, cordless: true }, null, null) === baseScore, "explicit null relatedProductSimilarity behaves identically to omitting it entirely");
  assert(computeFeatureScore({ rpm: 7500, cordless: true }, { rpm: 7400, cordless: true }, null, 0) === baseScore, "similarity of exactly 0 never applies a bonus (falsy-skip)");
  const partialBase = computeFeatureScore({ rpm: 7500, cordless: true }, { rpm: 7400, cordless: false }); // 0.5 structural
  const boosted = computeFeatureScore({ rpm: 7500, cordless: true }, { rpm: 7400, cordless: false }, null, 1);
  assert(approx(boosted, partialBase + partialBase * 0.10), `full similarity (1.0) adds exactly +10% of the base score (${partialBase} -> expected ${partialBase * 1.1}, got ${boosted})`);
  const cappedBoost = computeFeatureScore({ rpm: 7500, cordless: true }, { rpm: 7400, cordless: true }, null, 1); // base already 1.0
  assert(cappedBoost === 1, `bonus never pushes the score above 1.0 even when base is already 1.0 (got ${cappedBoost})`);
  // Differentiator blend + related-product bonus can coexist — the bonus
  // applies AFTER the differentiator interpolation, on the blended result.
  const withDifferentiator = computeFeatureScore({ rpm: 7500 }, { rpm: 7400 }, true); // structural=1, blended = 1*0.7 + 1*0.3 = 1
  const withBoth = computeFeatureScore({ rpm: 7500 }, { rpm: 7400 }, true, 1);
  assert(withBoth >= withDifferentiator, "related-product bonus never DECREASES the score relative to differentiator-only");

  console.log("\n[3] computeCompositeScore/DEFAULT_WEIGHTS untouched by this feature (regression)");
  assert(approx(DEFAULT_WEIGHTS.motor + DEFAULT_WEIGHTS.price + DEFAULT_WEIGHTS.feature, 1), "default weights still sum to 1.0");
  assert(approx(computeCompositeScore(1, 1, 1), 1), "perfect 3-dimension composite is still ~1 (weights untouched)");

  console.log("\n[4] buildRelatedProductsDiscoveryContext — null when empty, real sentence otherwise");
  assert(buildRelatedProductsDiscoveryContext([]) === null, "empty related-products list -> null (callers' .filter(Boolean) drops it cleanly)");
  assert(buildRelatedProductsDiscoveryContext([{ resolutionFailed: true, name: "Failed Product" } as any]) === null, "every entry failed resolution -> null");
  const contextSentence = buildRelatedProductsDiscoveryContext([{ name: "Wahl Elite Pro", brand: "Wahl", motor_type: "Rotary Motor", price: "$249.99" } as any]);
  assert(typeof contextSentence === "string" && contextSentence.includes("Wahl Elite Pro"), `real sentence names the related product (got: ${contextSentence})`);
  assert(contextSentence!.includes("Prioritize candidates with comparable profiles"), "sentence includes the spec's own required phrasing");

  console.log("\n[5] buildRelatedProductSeeds — only eligible/resolved products seed the pool, tagged for provenance");
  const seeds = buildRelatedProductSeeds([
    { asin: "B0RELATED1", name: "Eligible Related Product", eligibleForPoolSeeding: true, resolutionFailed: false } as any,
    { asin: "B0RELATED2", name: "Mismatched Tool Type", eligibleForPoolSeeding: false, resolutionFailed: false } as any,
    { asin: "B0RELATED3", name: "Failed Resolution", eligibleForPoolSeeding: true, resolutionFailed: true } as any,
  ], "legacy");
  assert(seeds.length === 1, `only the one eligible, successfully-resolved related product seeds the pool (got ${seeds.length})`);
  assert(seeds[0].asin === "B0RELATED1", "the correct related product was seeded");
  assert(seeds[0].related_product_seed === true, "seeded candidate is tagged related_product_seed: true for provenance");
  assert(seeds[0].tier === "legacy", "seeded candidate carries the requested tier");

  console.log("\n[6] selectByCompositeScore — related-product bonus never bypasses the motor-evidence gate (hard requirement)");
  {
    const motorFamilies = [
      { family_key: "brushless", label: "Brushless Motor", domain: "clipper_trimmer_shaver", aliases: ["brushless"], modifier: false, adjacent_families: [], enabled: true, sort_order: 0 },
      { family_key: "rotary", label: "Rotary Motor", domain: "clipper_trimmer_shaver", aliases: ["rotary"], modifier: false, adjacent_families: [], enabled: true, sort_order: 1 },
    ];
    const ourMotor = { familyKey: "brushless", label: "Brushless Motor", modifierKey: null, modifierLabel: null, source: "motor_tech_field" as const };
    const toolTypes = makeToolTypesFixture();
    const TARGET_PRICE = 300;

    // A related product with the WRONG motor family (rotary, not our
    // brushless) but otherwise very "similar" (same price, same specs) —
    // per the spec, this must still never let a same-profile candidate
    // skip the motor-evidence requirement.
    const relatedProducts = [{ motorFamilyKey: "rotary", priceRaw: 300, specs: { rpm: 7500, cordless: true } }];

    const ctxWithRelated: any = {
      motorFamilies, toolTypes, primaryCriterion: "motor", ourMotor, ourHeatTech: null,
      ourSpecs: { rpm: 7500, cordless: true, runTimeMinutes: null, buildMaterial: null, bladeTech: null },
      weights: { motor: 0.45, price: 0.35, feature: 0.2 },
      keyDiff: null,
      relatedProducts,
    };

    // A candidate with NO motor evidence at all (unverified) but the same
    // price/specs as the (wrong-motor) related product — should NOT be
    // promoted ahead of a real verified-motor candidate just because it
    // resembles a related product profile-wise.
    const pool = [
      { name: "BrandA Verified Brushless Clipper", brand: "BrandA", price_raw: 305, asin: "B0VERIFYD1", specifications: [{ name: "Motor Type", value: "Brushless Motor" }], feature_bullets: ["All-metal"], description: "" },
      { name: "BrandB Unverified Similar-Profile Clipper", brand: "BrandB", price_raw: 300, asin: "B0UNVERIF1" },
    ];
    const filtered = filterCandidatesByCategoryAndIdentity(pool, "legacy", CLIPPER_IDENTITY, toolTypes);
    const selected = selectByCompositeScore(filtered, TARGET_PRICE, "legacy", CLIPPER_IDENTITY, 1, ctxWithRelated, { requireMotorEvidenceFirst: true, allowStaticFallbackTopup: false });
    assert(selected.length === 1 && selected[0].asin === "B0VERIFYD1", "verified-motor candidate still wins the single slot over an unverified same-profile candidate — motor-evidence gate ordering is unchanged");

    // Now confirm the ADDITIVE bonus genuinely changes ranking when it's
    // the ONLY thing that differs — two verified-brushless candidates,
    // identical price, one shares specs with the related product (bonus
    // applies), the other doesn't.
    const tieBreakPool = [
      { name: "BrandC Matches Related Profile Clipper", brand: "BrandC", price_raw: 300, asin: "B0MATCH001", specifications: [{ name: "Motor Type", value: "Brushless Motor" }], feature_bullets: ["Cordless design"], description: "", rpm: 7500, cordless: true },
      { name: "BrandD No Feature Overlap Clipper", brand: "BrandD", price_raw: 300, asin: "B0MATCH002", specifications: [{ name: "Motor Type", value: "Brushless Motor" }], feature_bullets: [], description: "" },
    ];
    const ctxSameMotorRelated: any = { ...ctxWithRelated, relatedProducts: [{ motorFamilyKey: "brushless", priceRaw: 300, specs: { rpm: 7500, cordless: true } }] };
    const filteredTie = filterCandidatesByCategoryAndIdentity(tieBreakPool, "legacy", CLIPPER_IDENTITY, toolTypes);
    const scoredBoth = selectByCompositeScore(filteredTie, TARGET_PRICE, "legacy", CLIPPER_IDENTITY, 2, ctxSameMotorRelated, { requireMotorEvidenceFirst: true, allowStaticFallbackTopup: false });
    assert(scoredBoth.length === 2, "both candidates still get selected (bonus never excludes anything, purely additive to ranking)");
    const matchFeature = scoredBoth.find((c: any) => c.asin === "B0MATCH001");
    const noMatchFeature = scoredBoth.find((c: any) => c.asin === "B0MATCH002");
    assert(!!matchFeature && !!noMatchFeature && matchFeature.feature_score > noMatchFeature.feature_score, `the related-profile-similar candidate's feature_score is measurably higher (${matchFeature?.feature_score} vs ${noMatchFeature?.feature_score})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
