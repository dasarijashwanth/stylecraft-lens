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

    // Phase 1 and Phase 2a are now each an internal multi-round fill loop
    // (guarantees 5+5 competitors — see lib/analysisEngine.ts's
    // __phase1Fill/__phase2Fill checkpoints), so the EXACT number of calls
    // spent "at" phase 1 or phase 2 before advancing is no longer fixed —
    // it depends on how many rounds the mock/fallback data needs to satisfy
    // (or exhaust) the fill loop, same as it already varied for phase 4's
    // pre-existing 3b/3c internal repeat. The real, unchanging contract this
    // test must prove is: the DISTINCT phase numbers are visited in order
    // 1,2,3,4,5 — never skipped, never out of order, never regressing —
    // and the analysis reaches "complete". A generous iteration cap guards
    // against an infinite loop bug rather than asserting an exact count.
    const MAX_CALLS = 30;
    const distinctPhaseOrder: number[] = [];
    let finalStep: any = null;
    for (let i = 0; i < MAX_CALLS; i++) {
      const step = await runAnalysisStep(analysisId);
      if (step.pendingQuestion) {
        throw new Error(`Unexpected pause at call ${i + 1}: ${JSON.stringify(step.pendingQuestion)} — the fixture context should never trigger a pause-and-ask.`);
      }
      if (distinctPhaseOrder[distinctPhaseOrder.length - 1] !== step.phase) {
        distinctPhaseOrder.push(step.phase);
      }
      finalStep = step;
      if (step.status === "complete") break;
    }

    assert(finalStep?.status === "complete", `the analysis reaches status "complete" within ${MAX_CALLS} calls (got ${finalStep?.status})`);
    assert(
      JSON.stringify(distinctPhaseOrder) === JSON.stringify([1, 2, 3, 4, 5]),
      `the distinct phase numbers visited are exactly [1,2,3,4,5] in order, regardless of how many internal fill-loop rounds each took (got ${JSON.stringify(distinctPhaseOrder)})`
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
