// scripts/verify-weight-normalization.ts
// Offline regression check for Fix 1 (free weight entry, internal
// normalization) — lib/competitor-scoring.ts's computeCompositeScore no
// longer assumes pre-normalized weights; raw entered values (any
// non-negative scale) are divided by their sum at use-time. No live API
// calls — pure synchronous functions only.
//
// Run with: npx tsx scripts/verify-weight-normalization.ts

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

function approxEqual(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}

async function main() {
  const { computeCompositeScore, DEFAULT_WEIGHTS } = await import("../lib/competitor-scoring");

  console.log("\n[1] Raw 10/6/2 weights normalize internally to 0.556/0.333/0.111");
  const score = computeCompositeScore(1, 1, 1, { motor: 10, price: 6, feature: 2 });
  // All three sub-scores are 1, so composite should equal the normalized
  // weights' sum = 1 regardless of scale, proving normalization happened.
  assert(approxEqual(score, 1), `all-1.0 sub-scores composite to ~1.0 regardless of weight scale (got ${score})`);

  const motorOnlyScore = computeCompositeScore(1, 0, 0, { motor: 10, price: 6, feature: 2 });
  assert(approxEqual(motorOnlyScore, 10 / 18), `motor-only contribution reflects the normalized share (10/18 ≈ ${(10 / 18).toFixed(4)}, got ${motorOnlyScore.toFixed(4)})`);

  console.log("\n[2] A 0-weight criterion contributes nothing");
  const zeroFeatureScore = computeCompositeScore(0.5, 0.5, 1.0, { motor: 45, price: 35, feature: 0 });
  const zeroFeatureExpected = (45 / 80) * 0.5 + (35 / 80) * 0.5; // feature's 1.0 sub-score contributes 0
  assert(approxEqual(zeroFeatureScore, zeroFeatureExpected), `feature weight 0 means its perfect 1.0 sub-score contributes nothing (got ${zeroFeatureScore.toFixed(4)}, expected ${zeroFeatureExpected.toFixed(4)})`);

  console.log("\n[3] Default weights (already sum to 1) behave identically to before");
  const defaultScore = computeCompositeScore(0.8, 0.6, 0.4);
  const expectedDefault = DEFAULT_WEIGHTS.motor * 0.8 + DEFAULT_WEIGHTS.price * 0.6 + DEFAULT_WEIGHTS.feature * 0.4;
  assert(approxEqual(defaultScore, expectedDefault), `omitting weights (DEFAULT_WEIGHTS, already sums to 1) is unchanged (got ${defaultScore.toFixed(4)}, expected ${expectedDefault.toFixed(4)})`);

  console.log("\n[4] Zero/invalid weight sum falls back to DEFAULT_WEIGHTS rather than dividing by zero");
  const allZeroScore = computeCompositeScore(0.8, 0.6, 0.4, { motor: 0, price: 0, feature: 0 });
  assert(!isNaN(allZeroScore) && isFinite(allZeroScore), `an all-zero weights object never produces NaN/Infinity (got ${allZeroScore})`);
  assert(approxEqual(allZeroScore, expectedDefault), `an all-zero weights object falls back to DEFAULT_WEIGHTS' proportions (got ${allZeroScore.toFixed(4)}, expected ${expectedDefault.toFixed(4)})`);

  console.log("\n[5] Scale-invariance — 90/60/20 and 9/6/2 (same ratio) produce the same composite score");
  const bigScale = computeCompositeScore(0.7, 0.3, 0.9, { motor: 90, price: 60, feature: 20 });
  const smallScale = computeCompositeScore(0.7, 0.3, 0.9, { motor: 9, price: 6, feature: 2 });
  assert(approxEqual(bigScale, smallScale), `identical ratios at different absolute scales produce the same composite score (got ${bigScale.toFixed(4)} vs ${smallScale.toFixed(4)})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
