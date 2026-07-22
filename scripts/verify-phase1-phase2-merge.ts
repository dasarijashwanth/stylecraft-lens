// scripts/verify-phase1-phase2-merge.ts
// Offline end-to-end check that lib/analysisEngine.ts's merged Phase 1+2
// step (large-brand + emerging competitor discovery, now run concurrently
// instead of as two sequential /continue round-trips) actually writes both
// phase1_result AND phase2_result and advances straight to phase 3 in a
// single runAnalysisStep call. Runs entirely against the memoryDb fallback,
// through the mock-data path (no OpenAI/Gemini/Rainforest key configured —
// no .env.local loaded, no live call of any kind).
//
// Run with: npx tsx scripts/verify-phase1-phase2-merge.ts

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
  const { createAnalysis, updateAnalysisPhase, getAnalysis } = await import("../lib/db/analyses");
  const { runAnalysisStep } = await import("../lib/analysisEngine");

  console.log("\n[1] Merged Phase 1+2 step — mock-data path (no AI providers configured)");

  const context = {
    productName: "Apex Clipper 3000",
    category: "Clippers",
    targetMarket: "pro",
    pricePoint: "$259.95", // resolveDiscoveryTargetPrice needs this to avoid a pause-and-ask
    motorTech: "Brushless motor",
    keyDiff: "Longer runtime",
    companyContext: null,
    description: "Professional-grade hair clipper",
  };

  const identityCard = {
    productName: "Apex Clipper 3000",
    brand: "Apex",
    category: "Clippers",
    subcategory: "Hair Clippers",
    whatItIs: "A professional cordless hair clipper",
    keyAttributes: ["cordless", "brushless motor"],
    targetUser: "pro" as const,
    priceObserved: null,
    confidence: "high" as const,
    evidence: [],
    identityStatus: "verified" as const,
  };

  const created = await createAnalysis("test_user_1", "dev_org_id", undefined, context);
  const analysisId = created.id;

  // Simulate Phase 0 (identification) already having completed — advances
  // the record to phase 1, which is where the merged Phase 1+2 step lives.
  await updateAnalysisPhase(analysisId, 1, "phase0_result", identityCard, 0);

  const step = await runAnalysisStep(analysisId);

  assert(step.phase === 3, `merged step advances straight from phase 1 to phase 3 (got phase ${step.phase})`);
  assert(step.status === "running", `merged step reports status "running", not complete/failed (got "${step.status}")`);
  assert(!!step.stepResult?.phase1?.competitors, "stepResult.phase1.competitors is present");
  assert(!!step.stepResult?.phase2?.competitors, "stepResult.phase2.competitors is present");
  assert(Array.isArray(step.stepResult?.phase1?.competitors), "phase1 competitors is an array");
  assert(Array.isArray(step.stepResult?.phase2?.competitors), "phase2 competitors is an array");

  const persisted = await getAnalysis(analysisId);
  assert(persisted.phase === 3, `the persisted DB record's phase is 3 after the merged step (got ${persisted.phase})`);
  assert(!!persisted.phase1_result && Object.keys(persisted.phase1_result).length > 0, "phase1_result was actually persisted to the DB");
  assert(!!persisted.phase2_result && Object.keys(persisted.phase2_result).length > 0, "phase2_result was actually persisted to the DB (in the SAME merged step, not a separate later request)");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
