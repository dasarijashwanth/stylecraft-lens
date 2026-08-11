// scripts/verify-sweep-gate-contamination.ts
// Offline regression check for lib/analysisEngine.ts's Part 1E post-
// selection sweep, sweepGroomingGateContamination — plants the real
// "Electric Weed Wacker with Wheel" contamination fixture inside an
// otherwise-clean final competitor list, alongside a clean runner-up, and
// confirms the sweep catches it, logs exactly one new grooming-gate
// incident, and swaps in the clean replacement. No live API calls — run
// bare (no .env.local loaded), so isSupabaseConfigured/hasRainforestKey
// stay false and everything routes through memoryDb.
//
// Run with: npx tsx scripts/verify-sweep-gate-contamination.ts

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

async function main() {
  const { sweepGroomingGateContamination } = await import("../lib/analysisEngine");
  const { listGroomingGateRules, getGroomingGateConfidenceThreshold, getGroomingGateIncidents } = await import("../lib/db/grooming-gate-rules");
  const { listToolTypes } = await import("../lib/db/tool-types");
  const { listMotorFamilies } = await import("../lib/db/motor-families");
  const { resolveOurMotorType } = await import("../lib/motor-extraction");
  const { deriveGroomingTag } = await import("../lib/grooming-tag-taxonomy");
  const { extractOurSpecsFromTds } = await import("../lib/spec-extraction");
  const { DEFAULT_WEIGHTS } = await import("../lib/competitor-scoring");

  const identity: any = {
    productName: "TestCraft Pro Clipper 5000",
    brand: "TestCraft",
    category: "Hair Clippers",
    subcategory: "Professional Hair Clippers",
    whatItIs: "a professional cordless hair clipper",
    keyAttributes: ["brushless motor", "cordless"],
    targetUser: "pro",
    priceObserved: { value: 259.95, currency: "USD", source: "test" },
    confidence: "high",
    evidence: [],
    identityStatus: "confirmed",
    toolType: "clipper",
  };

  function makeCompetitor(i: number, opts: { name: string; brand: string; asin: string; price: number }) {
    return {
      name: opts.name,
      brand: opts.brand,
      tier: "legacy",
      asin: opts.asin,
      amazon_url: `https://www.amazon.com/dp/${opts.asin}`,
      price: `$${opts.price.toFixed(2)}`,
      price_raw: opts.price,
      rating: "4.5",
      review_count: "1,200",
      monthly_sales: "500+",
      bsr_rank: 100 + i,
      initials: opts.brand.slice(0, 2).toUpperCase(),
      categories: ["Beauty & Personal Care", "Hair Cutting Tools", "Hair Clippers"],
      bestsellers_rank_full: [{ category: "Hair Clippers", rank: 10 + i }],
      key_features: ["Brushless motor", "Cordless design"],
      top_feature_summary: "Professional brushless cordless hair clipper",
      feature_bullets: ["Brushless motor up to 7000rpm", "Cordless design", "Includes guide combs"],
      description: "A professional brushless cordless hair clipper for barbers.",
      strengths: [],
      weaknesses: [],
      recent_news: [],
      motor_type: "Brushless",
      motor_family_key: "brushless",
      motor_match_tier: "exact",
      motor_score: 1,
      price_score: 0.9,
      price_logic: "absolute",
      feature_score: 0.8,
      composite_score: 0.85,
      verified_by_rainforest: true,
    };
  }

  const contaminantAsin = "B0BADASIN5";
  const finalList = [
    makeCompetitor(1, { name: "Wahl Senior Clipper", brand: "Wahl", asin: "B0AAA00001", price: 249.95 }),
    makeCompetitor(2, { name: "Andis Master Clipper", brand: "Andis", asin: "B0AAA00002", price: 259.95 }),
    makeCompetitor(3, { name: "Oster Classic 76 Clipper", brand: "Oster", asin: "B0AAA00003", price: 239.95 }),
    makeCompetitor(4, { name: "BaBylissPRO FX Clipper", brand: "BaBylissPRO", asin: "B0AAA00004", price: 269.95 }),
    {
      ...makeCompetitor(5, { name: "Electric Weed Wacker With Wheel", brand: "GardenPro", asin: contaminantAsin, price: 254.95 }),
      categories: ["Patio, Lawn & Garden"],
      bestsellers_rank_full: [{ category: "Patio, Lawn & Garden", rank: 3 }],
      top_feature_summary: "powerful brushless motor, cuts weeds and grass easily",
      key_features: ["powerful brushless motor", "cuts weeds and grass easily"],
      feature_bullets: ["Powerful brushless motor", "Cuts weeds and grass easily"],
      description: "Electric weed wacker with wheel for lawn and garden use.",
    },
  ];

  const runnerUpPool = [
    makeCompetitor(6, { name: "RivalBrand Cordless Clipper 4000", brand: "RivalBrand", asin: "B0RUP00001", price: 244.95 }),
  ];

  const toolTypes = await listToolTypes();
  const motorFamilies = await listMotorFamilies();
  const ourMotor = await resolveOurMotorType({ motorFamily: "brushless", projectId: null }, identity, motorFamilies);
  const groomingGateRules = await listGroomingGateRules();
  const groomingGateConfidenceThreshold = await getGroomingGateConfidenceThreshold();
  const ourGroomingTag = deriveGroomingTag(identity.toolType, `${identity.category} ${identity.subcategory} ${identity.whatItIs}`);
  const ourSpecs = extractOurSpecsFromTds(null);

  const scoringCtx: any = {
    motorFamilies,
    toolTypes,
    primaryCriterion: "motor",
    ourMotor,
    ourHeatTech: null,
    ourSpecs,
    weights: DEFAULT_WEIGHTS,
    groomingGateRules,
    groomingGateConfidenceThreshold,
    ourGroomingTag,
    ourIsPetGrooming: false,
  };

  const ctx = {
    identity,
    tier: "legacy" as const,
    targetPriceRaw: 259.95,
    toolTypes,
    scoringCtx,
    excludeAsins: new Set<string>(),
    analysisId: "test_analysis_sweep_1",
  };

  const incidentsBefore = (await getGroomingGateIncidents(500)).filter(i => i.candidate_asin === contaminantAsin).length;

  console.log("\n[1] sweepGroomingGateContamination — catches the planted contaminant, replaces it, leaves clean survivors alone");
  const swept = await sweepGroomingGateContamination(finalList, runnerUpPool, ctx);

  assert(swept.length === finalList.length, `the swept list is still the same length as the input (got ${swept.length}, expected ${finalList.length})`);
  assert(!swept.some((c: any) => c.asin === contaminantAsin), "the contaminant (weed wacker) is gone from the swept list");
  assert(swept.some((c: any) => c.asin === "B0RUP00001"), "the clean runner-up replacement is present in the swept list");
  for (const asin of ["B0AAA00001", "B0AAA00002", "B0AAA00003", "B0AAA00004"]) {
    const original = finalList.find(c => c.asin === asin);
    const afterSweep = swept.find((c: any) => c.asin === asin);
    assert(!!afterSweep && JSON.stringify(afterSweep) === JSON.stringify(original), `clean survivor ${asin} is untouched by the sweep`);
  }

  console.log("\n[2] grooming_gate_incidents — exactly one new row logged for the contaminant");
  const incidentsAfter = await getGroomingGateIncidents(500);
  const matchingAfter = incidentsAfter.filter(i => i.candidate_asin === contaminantAsin);
  assert(matchingAfter.length === incidentsBefore + 1, `exactly one new incident row was logged for the contaminant's ASIN (before=${incidentsBefore}, after=${matchingAfter.length})`);
  const newest = matchingAfter[0];
  assert(newest?.phase === "phase1", `the incident is logged with phase:"phase1" (legacy tier) (got ${newest?.phase})`);
  assert(newest?.candidate_name === "Electric Weed Wacker With Wheel", `the incident records the contaminant's real name (got ${newest?.candidate_name})`);
  assert(!!newest?.failed_rule, `the incident records which rule actually failed it (got ${newest?.failed_rule})`);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
