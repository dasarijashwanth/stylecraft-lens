// scripts/verify-guaranteed-ten-competitors.ts
// Offline regression check for the guaranteed-10-competitors fill loop
// (lib/analysisEngine.ts's Phase 1a/2a multi-round dispatcher): every
// analysis renders EXACTLY 5 legacy + 5 emerging slots — either a real,
// motor-labeled competitor, or an honest empty_slot placeholder with a
// reason naming how much was actually searched — never a silent 3+3.
//
// No AI keys and no RAINFOREST_API_KEY are set — every phase falls through
// to its deterministic mock/fallback path (same technique as
// scripts/verify-phase-sequence-contract.ts), so this makes genuinely zero
// real network/API calls.
//
// Run with: npx tsx scripts/verify-guaranteed-ten-competitors.ts

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

async function main() {
  const { createAnalysis, getAnalysis } = await import("../lib/db/analyses");
  const { runAnalysisStep } = await import("../lib/analysisEngine");

  // Same non-registry fixture as verify-phase-sequence-contract.ts — takes
  // the AI-driven (mock-fallback) discovery branch for both tiers, so this
  // test exercises the fill loop's round dispatch honestly rather than the
  // curated-brand-registry path (covered separately by
  // verify-legacy-brand-discovery.ts).
  const context = {
    productName: "Ten-Guarantee Test Widget 5000",
    description: "A synthetic fixture product for the guaranteed-10-competitors regression test.",
    industry: "grooming-barbering",
    targetMarket: "both" as const,
    category: "Widget",
    toolType: "other_styling" as const,
    pricePoint: "$99.95",
    lineupTier: "mid" as const,
    orgId: "org_ten_guarantee_test",
    userId: "user_ten_guarantee_test",
    projectId: null,
  };

  const analysis = await createAnalysis(context.userId, context.orgId, undefined, context);
  const analysisId = analysis.id;

  const MAX_CALLS = 30;
  let lastStep: any = null;
  for (let i = 0; i < MAX_CALLS; i++) {
    lastStep = await runAnalysisStep(analysisId);
    if (lastStep.pendingQuestion) {
      throw new Error(`Unexpected pause: ${JSON.stringify(lastStep.pendingQuestion)} — this fixture should never trigger a pause-and-ask.`);
    }
    // Phase 3 (synthesis) needs both phase1_result and phase2_result
    // present — stop right after Phase 2 hands off (phase advances to 3),
    // since this test only cares about the competitor-count guarantee, not
    // the rest of the pipeline (already covered by
    // verify-phase-sequence-contract.ts).
    if (lastStep.phase >= 3) break;
  }

  const record: any = await getAnalysis(analysisId);
  assert(!!record?.phase1_result && !!record?.phase2_result, "both phase1_result and phase2_result are populated within the call budget");

  const phase1Competitors: any[] = record?.phase1_result?.competitors || [];
  const phase2Competitors: any[] = record?.phase2_result?.competitors || [];

  console.log("\n[1] Exactly 5 legacy + 5 emerging slots — real or honestly empty, never fewer");
  assert(phase1Competitors.length === 5, `phase1 (legacy) renders exactly 5 slots (got ${phase1Competitors.length})`);
  assert(phase2Competitors.length === 5, `phase2 (emerging) renders exactly 5 slots (got ${phase2Competitors.length})`);

  console.log("\n[2] Every slot is either a real competitor or an explicit, reasoned empty placeholder");
  for (const c of phase1Competitors) {
    if (c.empty_slot) {
      assert(typeof c.reason === "string" && c.reason.length > 0, `legacy empty slot carries a non-empty reason (got: ${JSON.stringify(c.reason)})`);
    } else {
      assert(typeof c.name === "string" && c.name.length > 0, "legacy real competitor has a name");
    }
  }
  for (const c of phase2Competitors) {
    if (c.empty_slot) {
      assert(typeof c.reason === "string" && c.reason.length > 0, `emerging empty slot carries a non-empty reason (got: ${JSON.stringify(c.reason)})`);
    } else {
      assert(typeof c.name === "string" && c.name.length > 0, "emerging real competitor has a name");
    }
  }

  console.log("\n[3] The fill loop actually ran (not just a single round silently truncated)");
  assert(typeof record?.phase1_result?.fill_rounds_used === "number" && record.phase1_result.fill_rounds_used >= 1, `phase1_result records how many fill rounds ran (got ${record?.phase1_result?.fill_rounds_used})`);
  assert(typeof record?.phase2_result?.fill_rounds_used === "number" && record.phase2_result.fill_rounds_used >= 1, `phase2_result records how many fill rounds ran (got ${record?.phase2_result?.fill_rounds_used})`);

  console.log("\n[4] No leftover internal fill-loop state once finalized (checkpoint markers are cleaned up)");
  assert(record?.phase1_result?.__phase1Fill === undefined, "phase1_result has no leftover __phase1Fill marker after finalizing");
  assert(record?.phase1_result?.__phase1Pool === undefined, "phase1_result has no leftover __phase1Pool after finalizing");
  assert(record?.phase2_result?.__phase2Stage === undefined, "phase2_result has no leftover __phase2Stage marker after finalizing");
  assert(record?.phase2_result?.__phase2Pool === undefined, "phase2_result has no leftover __phase2Pool after finalizing");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

// Touches lib/db/analyses.ts, which always tries Prisma first before
// falling back to memoryDb — the failed Prisma connection attempt leaves a
// dangling handle that keeps the process alive after main() resolves.
// Explicit exit forces a clean process end either way.
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
