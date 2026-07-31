// scripts/verify-competitor-correction.ts
// Offline regression check for the editable-ASIN + correction-learning
// feature (lib/analysisEngine.ts's replaceCompetitor and PART 3's
// blocklist/penalty/preference/prompt-digest signals). globalThis.fetch is
// stubbed before anything is imported (same pattern as
// scripts/verify-motor-price-discovery.ts) so this makes zero real
// Rainforest/OpenAI/Gemini calls. No .env.local loaded, so every DB-backed
// helper runs against memoryDb.
//
// Run with: npx tsx scripts/verify-competitor-correction.ts

export {};

process.env.RAINFOREST_API_KEY = "test-key-not-a-real-credential";

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

// Fixture Rainforest "type=product" responses, keyed by ASIN.
const RAINFOREST_PRODUCTS: Record<string, any> = {
  B0NEWGOOD1: {
    request_info: { success: true },
    product: {
      asin: "B0NEWGOOD1", title: "Andis GTX-EXO Cordless Trimmer", brand: "Andis", manufacturer: "Andis",
      buybox_winner: { price: { value: 249.99 } }, rating: 4.7, ratings_total: 3200,
      feature_bullets: ["Vector motor for consistent power", "All-metal housing"],
      specifications: [{ name: "Motor Type", value: "Vector Motor" }],
      description: "A professional cordless trimmer.", main_image: { link: "https://example.com/img1.jpg" }, images: [],
    },
  },
  B0DUPLICATE: {
    request_info: { success: true },
    product: { asin: "B0DUPLICATE", title: "Existing Sibling Trimmer", brand: "Wahl", buybox_winner: { price: { value: 199.99 } }, rating: 4.5, ratings_total: 900, feature_bullets: [], specifications: [] },
  },
};

(globalThis as any).fetch = async (input: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.includes("rainforestapi.com")) return new Response("{}", { status: 500 });
  const u = new URL(url);
  if (u.searchParams.get("type") !== "product") return new Response(JSON.stringify({ request_info: { success: false } }), { status: 200 });
  const asin = u.searchParams.get("asin") || "";
  const fixture = RAINFOREST_PRODUCTS[asin];
  if (!fixture) return new Response(JSON.stringify({ request_info: { success: false } }), { status: 200 });
  return new Response(JSON.stringify(fixture), { status: 200 });
};

async function main() {
  const {
    buildCorrectionSignals,
    buildCorrectionsGuidance,
    seedKnownGoodCandidates,
    replaceCompetitor,
    resolveAsinFromInput,
  } = await import("../lib/analysisEngine");
  const {
    recordCorrection,
    getActiveCorrectionsForToolType,
    listAllCorrections,
    expireCorrection,
    reactivateCorrection,
  } = await import("../lib/db/competitor-corrections");
  const { createAnalysis, getAnalysis } = await import("../lib/db/analyses");

  console.log("\n[1] resolveAsinFromInput — plain ASIN and pasted Amazon URL both resolve");
  assert(resolveAsinFromInput("b0newgood1") === "B0NEWGOOD1", "lowercase plain ASIN resolves and uppercases");
  assert(resolveAsinFromInput("https://www.amazon.com/Some-Title/dp/B0NEWGOOD1/ref=xyz") === "B0NEWGOOD1", "a /dp/ URL resolves to its ASIN");
  assert(resolveAsinFromInput("https://www.amazon.com/gp/product/B0NEWGOOD1") === "B0NEWGOOD1", "a /gp/product/ URL resolves to its ASIN");
  assert(resolveAsinFromInput("not an asin or url") === null, "unrecognizable input resolves to null, never a guess");

  console.log("\n[2] buildCorrectionSignals — 2+ independent corrections block, exactly 1 penalizes");
  {
    const now = new Date().toISOString();
    const fixture: any[] = [
      { old_asin: "B0BLOCKED01", reason: "wrong_product", tool_type: "trimmer" },
      { old_asin: "B0BLOCKED01", reason: "discontinued", tool_type: "trimmer" },
      { old_asin: "B0PENALIZED", reason: "wrong_product", tool_type: "trimmer" },
      { old_asin: "B0IGNOREDXX", reason: "wrong_model", tool_type: "trimmer" },
    ].map(c => ({ ...c, id: "x", analysis_id: null, project_id: null, motor_family: null, heat_tech_family: null, price_band: null, old_title: null, new_asin: "B0X", new_title: null, note: null, user_id: null, expired_at: null, created_at: now }));
    const signals = buildCorrectionSignals(fixture);
    assert(signals.blockedAsins.has("B0BLOCKED01"), "an ASIN with 2 independent wrong_product/discontinued corrections is blocked");
    assert(signals.penalizedAsins.has("B0PENALIZED"), "an ASIN with exactly 1 correction is penalized, not blocked");
    assert(!signals.blockedAsins.has("B0PENALIZED"), "a penalized ASIN is never also blocked");
    assert(!signals.blockedAsins.has("B0IGNOREDXX") && !signals.penalizedAsins.has("B0IGNOREDXX"), "a wrong_model correction (not wrong_product/discontinued) contributes to neither signal");
  }

  console.log("\n[3] buildCorrectionsGuidance — prior-rejection/preference text, capped to 10 entries");
  {
    const now = new Date().toISOString();
    const makeCorr = (reason: string, oldTitle: string, newTitle: string): any => ({
      id: "x", analysis_id: null, project_id: null, tool_type: "trimmer", motor_family: null, heat_tech_family: null, price_band: null,
      old_asin: "B0OLD", old_title: oldTitle, new_asin: "B0NEW", new_title: newTitle, reason, note: null, user_id: null, expired_at: null, created_at: now,
    });
    const digest = buildCorrectionsGuidance([
      makeCorr("wrong_product", "BadPick One", ""),
      makeCorr("better_competitor", "", "GreatPick One"),
    ]);
    assert(!!digest && digest.includes("BadPick One") && digest.includes("avoid similar"), "digest names a rejected competitor and warns against similar picks");
    assert(!!digest && digest.includes("GreatPick One") && digest.includes("rank higher"), "digest names a preferred competitor and asks for similar ranking");

    const manyRejections = Array.from({ length: 15 }, (_, i) => makeCorr("wrong_product", `Rejected${i}`, ""));
    const cappedDigest = buildCorrectionsGuidance(manyRejections);
    assert(!!cappedDigest && cappedDigest.includes("Rejected0") && !cappedDigest.includes("Rejected10"), "digest is capped to the first 10 entries (newest-first ordering assumed from the caller)");

    assert(buildCorrectionsGuidance([]) === null, "an empty correction list produces no digest at all (never an empty-but-present instruction)");
  }

  console.log("\n[4] recordCorrection / getActiveCorrectionsForToolType / expireCorrection / reactivateCorrection — full round trip");
  {
    const created = await recordCorrection({
      analysisId: null, projectId: null, toolType: "verify_correction_tool_type",
      oldAsin: "B0ROUNDTRIP", oldTitle: "Old Title", newAsin: "B0NEWGOOD1", newTitle: "New Title",
      reason: "wrong_product", note: "test note", userId: "test_user",
    });
    assert(!!created.id && created.expired_at === null, "recordCorrection returns a real row with expired_at initially null");

    const active1 = await getActiveCorrectionsForToolType("verify_correction_tool_type");
    assert(active1.some(c => c.id === created.id), "the new correction appears in the active list for its tool type");

    await expireCorrection(created.id);
    const active2 = await getActiveCorrectionsForToolType("verify_correction_tool_type");
    assert(!active2.some(c => c.id === created.id), "expiring a correction removes it from the ACTIVE list");

    const all = await listAllCorrections();
    assert(all.some(c => c.id === created.id && c.expired_at !== null), "the expired correction still appears in the full admin list (listAllCorrections), never deleted");

    await reactivateCorrection(created.id);
    const active3 = await getActiveCorrectionsForToolType("verify_correction_tool_type");
    assert(active3.some(c => c.id === created.id), "reactivating restores the correction to the active list");
  }

  console.log("\n[5] seedKnownGoodCandidates — 'better_competitor' corrections become a live-reverified seed, capped and scoped");
  {
    const now = new Date().toISOString();
    const signals = {
      blockedAsins: new Set<string>(), penalizedAsins: new Set<string>(),
      corrections: [
        { id: "x", analysis_id: null, project_id: null, tool_type: "trimmer", motor_family: "vector", heat_tech_family: null, price_band: "professional", old_asin: "B0OLD1", old_title: null, new_asin: "B0NEWGOOD1", new_title: "Andis GTX-EXO", reason: "better_competitor", note: null, user_id: null, expired_at: null, created_at: now },
        { id: "y", analysis_id: null, project_id: null, tool_type: "trimmer", motor_family: "vector", heat_tech_family: null, price_band: "professional", old_asin: "B0OLD2", old_title: null, new_asin: "B0NOTFOUNDXX", new_title: "No Longer Live", reason: "better_competitor", note: null, user_id: null, expired_at: null, created_at: now },
        { id: "z", analysis_id: null, project_id: null, tool_type: "trimmer", motor_family: "rotary", heat_tech_family: null, price_band: "professional", old_asin: "B0OLD3", old_title: null, new_asin: "B0WRONGFAMILY", new_title: "Wrong Motor Family", reason: "better_competitor", note: null, user_id: null, expired_at: null, created_at: now },
      ],
    };
    const seeds = await seedKnownGoodCandidates(signals as any, "legacy", "motor", { familyKey: "vector", label: "Vector Motor", modifierKey: null, modifierLabel: null, source: "motor_family_field" } as any, null, "professional");
    assert(seeds.length === 1, `only the live-resolvable, same-family, same-price-band correction becomes a seed (got ${seeds.length})`);
    assert(seeds[0]?.asin === "B0NEWGOOD1" && seeds[0]?.known_good_seed === true, "the seeded candidate carries the real re-fetched product data and is tagged known_good_seed");
    assert(seeds[0]?.tier === "legacy", "the seed is tagged with whichever tier it's being seeded into");
  }

  console.log("\n[6] replaceCompetitor — rebuilds exactly one competitor in place, records the correction, rejects a duplicate ASIN");
  {
    const context: any = {
      productName: "Apex Cordless Trimmer", description: "test", industry: "grooming-barbering", targetMarket: "both" as const,
      category: "Clippers", toolType: "trimmer", pricePoint: "$249.99", orgId: "org_correction_test", userId: "user_correction_test", projectId: null,
    };
    const analysis = await createAnalysis(context.userId, context.orgId, undefined, context);
    const analysisId = analysis.id;

    const identity: any = {
      productName: context.productName, category: "Clippers", subcategory: "Professional Trimmer", whatItIs: "A cordless trimmer",
      keyAttributes: [], targetUser: "both", confidence: "high", evidence: [], identityStatus: "verified", toolType: "trimmer",
    };
    const fixtureCompetitors = [
      { name: "Old Wrong Trimmer", brand: "WrongBrand", asin: "B0OLDWRONG1", amazon_url: "https://www.amazon.com/dp/B0OLDWRONG1", price: "$199.99", price_raw: 199.99, rating: "4.0", review_count: "50", tier: "legacy" },
      { name: "Kept Sibling Trimmer", brand: "Wahl", asin: "B0DUPLICATE", amazon_url: "https://www.amazon.com/dp/B0DUPLICATE", price: "$199.99", price_raw: 199.99, rating: "4.5", review_count: "900", tier: "legacy" },
    ];

    const { patchAnalysisPhaseResults, updateAnalysisPhase } = await import("../lib/db/analyses");
    await patchAnalysisPhaseResults(analysisId, { phase1_result: { competitors: fixtureCompetitors } });
    // phase0_result (the Identity Card) has no dedicated patch helper —
    // written the same way updateAnalysisPhase already does elsewhere.
    await updateAnalysisPhase(analysisId, 2, "phase0_result", identity, 0);

    let threwDuplicate = false;
    try {
      await replaceCompetitor(analysisId, "B0OLDWRONG1", "B0DUPLICATE", "user_correction_test", { reason: "wrong_product" });
    } catch {
      threwDuplicate = true;
    }
    assert(threwDuplicate, "replacing with an ASIN that's already one of the analysis's other competitors is rejected");

    const result = await replaceCompetitor(analysisId, "B0OLDWRONG1", "B0NEWGOOD1", "user_correction_test", { reason: "wrong_product", note: "test swap" });
    assert(result.competitor.asin === "B0NEWGOOD1", `the returned competitor carries the new ASIN (got ${result.competitor.asin})`);
    assert(result.competitor.manually_selected === true && result.competitor.replaced_from_asin === "B0OLDWRONG1", "the returned competitor is tagged manually_selected with its replaced_from_asin");

    const updated: any = await getAnalysis(analysisId);
    const competitors = updated.phase1_result.competitors;
    assert(competitors.length === 2, "the competitors array still has exactly 2 entries — a swap, never an add/remove");
    assert(competitors.some((c: any) => c.asin === "B0NEWGOOD1"), "the new ASIN now appears in phase1_result.competitors");
    assert(!competitors.some((c: any) => c.asin === "B0OLDWRONG1"), "the old ASIN no longer appears anywhere in phase1_result.competitors");
    assert(competitors.some((c: any) => c.asin === "B0DUPLICATE"), "the untouched sibling competitor is still present, unmodified");

    const corrections = await listAllCorrections();
    assert(corrections.some(c => c.old_asin === "B0OLDWRONG1" && c.new_asin === "B0NEWGOOD1" && c.reason === "wrong_product"), "the swap recorded a competitor_corrections row with the right old/new ASINs and reason");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
