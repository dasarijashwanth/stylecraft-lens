// scripts/verify-slot-refill.ts
// Offline regression check for lib/analysisEngine.ts's Part 3 Remove +
// Refill single-slot primitives: removeCompetitorSlot / refillCompetitorSlot.
// No live API calls — run bare (no .env.local loaded), so
// isSupabaseConfigured/hasRainforestKey are both false and everything
// routes through memoryDb; a synthetic analysis is pushed directly into
// memoryDb.analyses (bypassing the real pipeline) with a populated
// runnerUpPool, exercising Tier A of fetchReplacementForSlot only — Tier B
// (a live Rainforest search) is structurally unreachable in this
// environment, which is exactly the point.
//
// Run with: npx tsx scripts/verify-slot-refill.ts

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
  const { memoryDb } = await import("../lib/memoryDb");
  const { removeCompetitorSlot, refillCompetitorSlot } = await import("../lib/analysisEngine");

  const analysisId = "test_analysis_slot_refill_1";
  const now = new Date();

  const identity = {
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

  const existingCompetitors = [
    makeCompetitor(1, { name: "Wahl Senior Clipper", brand: "Wahl", asin: "B0AAA00001", price: 249.95 }),
    makeCompetitor(2, { name: "Andis Master Clipper", brand: "Andis", asin: "B0AAA00002", price: 259.95 }),
    makeCompetitor(3, { name: "Oster Classic 76 Clipper", brand: "Oster", asin: "B0AAA00003", price: 239.95 }),
    makeCompetitor(4, { name: "BaBylissPRO FX Clipper", brand: "BaBylissPRO", asin: "B0AAA00004", price: 269.95 }),
    // The 5th slot is the deliberately contaminated fixture — a real
    // "wrong industry" pick that removeCompetitorSlot will be asked to
    // remove below.
    {
      ...makeCompetitor(5, { name: "Electric Weed Wacker With Wheel", brand: "GardenPro", asin: "B0BADASIN5", price: 254.95 }),
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
    makeCompetitor(7, { name: "SecondChoice Pro Clipper", brand: "SecondChoice", asin: "B0RUP00002", price: 264.95 }),
  ];

  // memoryDb persists across script runs via .local-data/memdb-snapshot.json
  // (see lib/memoryDb.ts) — a bare re-run of this script would otherwise
  // accumulate duplicate-id analyses from previous runs (including any
  // left mutated by a previously-failing run), and Array.find() would pick
  // up a stale copy instead of the fresh one just pushed below. Scrub any
  // prior copy first so this script is idempotent across reruns.
  for (let i = memoryDb.analyses.length - 1; i >= 0; i--) {
    if (memoryDb.analyses[i].id === analysisId) memoryDb.analyses.splice(i, 1);
  }

  memoryDb.analyses.push({
    id: analysisId,
    orgId: "dev_org_id",
    userId: "dev_user_id",
    projectId: null,
    status: "COMPLETE",
    phase: 4,
    context: {
      productName: identity.productName,
      industry: "grooming-barbering",
      targetMarket: "pro",
      description: "A professional cordless hair clipper",
      toolType: "clipper",
      motorFamily: "brushless",
      pricePoint: "259.95",
      lineupTier: "mid",
    },
    phase0Result: identity,
    phase1Result: {
      competitors: existingCompetitors.map(c => ({ ...c })),
      runnerUpPool: runnerUpPool.map(c => ({ ...c })),
      removedAsins: [],
    },
    phase2Result: null,
    phase3Result: null,
    pendingQuestion: null,
    errorMessage: null,
    durationMs: 1000,
    createdAt: now,
    completedAt: now,
  } as any);

  // Snapshot the 4 clean competitors BEFORE any mutation, for the
  // deep-equal untouched-sibling checks below.
  const cleanSnapshot = existingCompetitors.slice(0, 4).map(c => JSON.parse(JSON.stringify(c)));
  function siblingsUntouched(currentList: any[]): boolean {
    return cleanSnapshot.every(orig => {
      const current = currentList.find((c: any) => c.asin === orig.asin);
      return !!current && JSON.stringify(current) === JSON.stringify(orig);
    });
  }

  console.log("\n[1] removeCompetitorSlot — targeted slot swaps to a placeholder, siblings untouched");
  const removeResult = await removeCompetitorSlot(analysisId, "B0BADASIN5", "test_actor", { reason: "wrong_industry", note: "This is a weed wacker, not a hair clipper." });
  assert(removeResult.removedAsin === "B0BADASIN5", `removeCompetitorSlot reports the removed ASIN (got ${removeResult.removedAsin})`);
  assert(removeResult.tier === "legacy", `removeCompetitorSlot correctly resolves the legacy tier (got ${removeResult.tier})`);

  const afterRemove: any = memoryDb.analyses.find(a => a.id === analysisId);
  const removedSlot = afterRemove.phase1Result.competitors.find((c: any) => c.removed_asin === "B0BADASIN5");
  assert(!!removedSlot, "the removed slot's array entry is now a placeholder carrying removed_asin");
  assert(removedSlot.empty_slot === true, "the placeholder is flagged empty_slot:true");
  assert(removedSlot.removed_reason === "wrong_industry", `the placeholder records the removal reason (got ${removedSlot.removed_reason})`);
  assert(Array.isArray(afterRemove.phase1Result.removedAsins) && afterRemove.phase1Result.removedAsins.includes("B0BADASIN5"), "removedAsins now includes the removed ASIN");

  const stillPresent = afterRemove.phase1Result.competitors.filter((c: any) => !c.empty_slot);
  assert(stillPresent.length === 4, `exactly 4 real (non-placeholder) competitors remain (got ${stillPresent.length})`);
  assert(siblingsUntouched(afterRemove.phase1Result.competitors), "the other 4 competitor objects are deep-equal to their pre-call snapshots — no full re-run");

  console.log("\n[2] refillCompetitorSlot — Tier A (saved runner-up pool), zero network calls");
  const refillResult: any = await refillCompetitorSlot(analysisId, "B0BADASIN5", "test_actor");
  assert(refillResult.ok === true, `refill succeeds from the seeded runner-up pool (got ok=${refillResult.ok}, reason=${refillResult.reason})`);
  assert(refillResult.source === "runner_up_pool", `refill source is "runner_up_pool" — Tier B/live search is structurally unreachable offline (got ${refillResult.source})`);
  const refilledAsin = refillResult.competitor?.asin;
  assert(["B0RUP00001", "B0RUP00002"].includes(refilledAsin), `the refilled competitor's ASIN came from the seeded runner-up pool (got ${refilledAsin})`);

  const afterRefill: any = memoryDb.analyses.find(a => a.id === analysisId);
  const slotNowFilled = afterRefill.phase1Result.competitors.find((c: any) => c.asin === refilledAsin);
  assert(!!slotNowFilled && slotNowFilled.slot_refilled === true, "the slot now holds the new competitor, tagged slot_refilled:true (distinct from manually_selected)");
  const stillPresentAfterRefill = afterRefill.phase1Result.competitors.filter((c: any) => !c.empty_slot);
  assert(stillPresentAfterRefill.length === 5, `all 5 slots are real competitors again after refill (got ${stillPresentAfterRefill.length})`);
  assert(siblingsUntouched(afterRefill.phase1Result.competitors), "the original 4 competitors are STILL deep-equal to their pre-call snapshots after refill");
  assert(!afterRefill.phase1Result.runnerUpPool.some((c: any) => c.asin === refilledAsin), "the consumed candidate is removed from the stored runnerUpPool");

  console.log("\n[3] pool exhaustion — once the runner-up pool (and, offline, Tier B) run dry, refill is an honest ok:false");
  // Remove one of the ORIGINAL 4 real competitors this time — the runner-up
  // pool has exactly 1 entry left after step 2 consumed the other.
  const secondVictimAsin = "B0AAA00001";
  await removeCompetitorSlot(analysisId, secondVictimAsin, "test_actor", { reason: "other", note: "testing pool exhaustion" });
  const stillOneLeftRefill: any = await refillCompetitorSlot(analysisId, secondVictimAsin, "test_actor");
  assert(stillOneLeftRefill.ok === true, `refill still succeeds — exactly one runner-up remains at this point (got ok=${stillOneLeftRefill.ok})`);

  // Now the pool is empty — a third remove+refill should come back empty-handed.
  const thirdVictimAsin = "B0AAA00002";
  await removeCompetitorSlot(analysisId, thirdVictimAsin, "test_actor", { reason: "other", note: "testing pool exhaustion" });
  const exhaustedRefill: any = await refillCompetitorSlot(analysisId, thirdVictimAsin, "test_actor");
  assert(exhaustedRefill.ok === false, `once the runner-up pool is exhausted (and Tier B is unreachable offline), refill returns an honest ok:false rather than throwing (got ok=${exhaustedRefill.ok})`);
  assert(typeof exhaustedRefill.reason === "string" && exhaustedRefill.reason.length > 0, "the honest failure includes a human-readable reason");

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
