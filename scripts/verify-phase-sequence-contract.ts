// scripts/verify-phase-sequence-contract.ts
// Regression test C (per the Motor+Price-Led Discovery plan's Phase F):
// proves the analysis pipeline's phase sequence, labels, and pause-field
// contract are completely UNCHANGED by the motor/price-led discovery
// rework — that rework only changes research logic INSIDE Phase 1/2, never
// the phase numbering, progress UI, or checkpoint/retry behavior.
//
// No AI keys and no RAINFOREST_API_KEY are set at all — every phase falls
// through to its deterministic mock/fallback path (identifyProduct's
// fallbackIdentity, generateMockPhase1/2/3, getCategoryFallbackCompetitors
// — all pure, zero network calls), so this makes genuinely zero real
// network/API calls without needing any fetch stubbing.
//
// Run with: npx tsx scripts/verify-phase-sequence-contract.ts

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
  const { PHASE_LABELS, PENDING_QUESTION_PHASE_INDEX } = await import("../components/analyze/ProgressPanel");
  const { createAnalysis, getAnalysis } = await import("../lib/db/analyses");
  const { runAnalysisStep } = await import("../lib/analysisEngine");

  console.log("\n[1] Static contract — phase labels and pause-field mapping are exactly what's expected");
  {
    assert(PHASE_LABELS.length === 4, `PHASE_LABELS has exactly 4 entries (got ${PHASE_LABELS.length})`);
    assert(JSON.stringify(PHASE_LABELS) === JSON.stringify([
      "Identifying the product",
      "Researching large brand competitors",
      "Researching indie & emerging competitors",
      "Synthesizing market analysis & strategic recommendations",
    ]), "PHASE_LABELS text is byte-identical to the expected baseline");

    assert(JSON.stringify(PENDING_QUESTION_PHASE_INDEX) === JSON.stringify({
      category: 0, toolType: 0, pricePoint: 1, motorType: 1, lineupTier: 2,
    }), "PENDING_QUESTION_PHASE_INDEX mapping is byte-identical to the expected baseline");
  }

  console.log("\n[2] End-to-end walk — the literal phase sequence returned by runAnalysisStep is unchanged");
  {
    // Deliberately a non-registry category (no clipper/trimmer/shaver/
    // dryer/iron/styler/brush keyword) so Phase 1 takes the simpler
    // AI-driven (non-curated-registry) branch — this test's only job is
    // the phase-NUMBER contract, not exercising brand-site/curated-brand
    // discovery in detail (that's scripts/verify-brand-site-discovery.ts).
    const context = {
      productName: "Contract Test Widget 9000",
      description: "A synthetic fixture product for the phase-sequence regression test.",
      industry: "grooming-barbering",
      targetMarket: "both" as const,
      category: "Widget",
      toolType: "other_styling" as const,
      pricePoint: "$99.95",
      lineupTier: "mid" as const,
      orgId: "org_phase_contract_test",
      userId: "user_phase_contract_test",
      projectId: null,
    };

    const analysis = await createAnalysis(context.userId, context.orgId, undefined, context);
    const analysisId = analysis.id;

    const expectedSequence: { phase: number; status: string }[] = [
      { phase: 1, status: "running" },   // Phase 0 (identification) -> Phase 1
      { phase: 2, status: "running" },   // Phase 1 (legacy) -> Phase 2
      { phase: 3, status: "running" },   // Phase 2 (emerging) -> Phase 3
      { phase: 4, status: "running" },   // Phase 3a (synthesis) -> Phase 3b
      { phase: 4, status: "running" },   // Phase 3b (anti-boilerplate) -> Phase 3c
      { phase: 5, status: "complete" },  // Phase 3c (citations/finalize) -> complete
    ];

    const actualSequence: { phase: number; status: string }[] = [];
    for (let i = 0; i < expectedSequence.length; i++) {
      const step = await runAnalysisStep(analysisId);
      actualSequence.push({ phase: step.phase, status: step.status });
      if (step.pendingQuestion) {
        throw new Error(`Unexpected pause at call ${i + 1}: ${JSON.stringify(step.pendingQuestion)} — the fixture context should never trigger a pause-and-ask.`);
      }
    }

    assert(
      JSON.stringify(actualSequence) === JSON.stringify(expectedSequence),
      `phase sequence is exactly [1,2,3,4,4,5] with the right statuses (got ${JSON.stringify(actualSequence)})`
    );

    const finalRecord = await getAnalysis(analysisId);
    assert(finalRecord?.status === "complete", `the persisted analysis record itself reaches status "complete" (got ${finalRecord?.status})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

// This script (unlike the others) touches lib/db/analyses.ts, which always
// tries Prisma first before falling back to memoryDb — the failed Prisma
// connection attempt leaves a dangling handle that keeps the process alive
// after main() resolves. Explicit exit forces a clean process end either way.
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
