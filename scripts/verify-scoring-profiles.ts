// scripts/verify-scoring-profiles.ts
// Offline regression check for Fix 2 (per-tool-type weight profiles) —
// lib/db/scoring-profiles.ts against memoryDb (no .env.local loaded, so
// isSupabaseConfigured is false and every call exercises the memoryDb path
// directly). No live API calls.
//
// Run with: npx tsx scripts/verify-scoring-profiles.ts

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
  const { listScoringProfiles, getScoringProfileForToolType, upsertScoringProfile, deleteScoringProfile } = await import("../lib/db/scoring-profiles");

  console.log("\n[1] Seeded defaults — global default + one row per built-in motorized/heat-tech type");
  const all = await listScoringProfiles();
  assert(all.some(p => p.type_key === null), "a global default row (type_key: null) exists");
  assert(all.some(p => p.type_key === "clipper"), "clipper has its own seeded profile");
  assert(all.some(p => p.type_key === "dryer"), "dryer has its own seeded profile");
  assert(all.some(p => p.type_key === "flat_iron"), "flat_iron has its own seeded profile");

  console.log("\n[2] getScoringProfileForToolType — resolution order");
  const clipperProfile = await getScoringProfileForToolType("clipper");
  assert(clipperProfile.motor === 45 && clipperProfile.price === 35 && clipperProfile.feature === 20, `clipper resolves its own seeded 45/35/20 profile (got ${JSON.stringify(clipperProfile)})`);

  const dryerProfile = await getScoringProfileForToolType("dryer");
  assert(dryerProfile.motor === 35 && dryerProfile.price === 35 && dryerProfile.feature === 30, `dryer resolves its own seeded 35/35/30 profile (got ${JSON.stringify(dryerProfile)})`);

  const flatIronProfile = await getScoringProfileForToolType("flat_iron");
  assert(flatIronProfile.motor === 40 && flatIronProfile.price === 35 && flatIronProfile.feature === 25, `flat_iron resolves its own seeded 40/35/25 profile (this weight slot represents Heat/Plate Technology, got ${JSON.stringify(flatIronProfile)})`);

  const customTypeProfile = await getScoringProfileForToolType("a_brand_new_custom_type_xyz");
  assert(customTypeProfile.motor === 45 && customTypeProfile.price === 35 && customTypeProfile.feature === 20, `a custom type with no row of its own falls back to the global default (got ${JSON.stringify(customTypeProfile)})`);

  const noTypeProfile = await getScoringProfileForToolType(null);
  assert(noTypeProfile.motor === 45, "passing null/undefined resolves the global default directly");

  console.log("\n[3] Profile isolation — changing one type's profile never affects another's");
  await upsertScoringProfile("trimmer", { motor: 60, price: 25, feature: 15 });
  const trimmerAfter = await getScoringProfileForToolType("trimmer");
  const dryerAfterTrimmerChange = await getScoringProfileForToolType("dryer");
  const flatIronAfterTrimmerChange = await getScoringProfileForToolType("flat_iron");
  assert(trimmerAfter.motor === 60, `trimmer's own profile updated correctly (got ${JSON.stringify(trimmerAfter)})`);
  assert(dryerAfterTrimmerChange.motor === 35 && dryerAfterTrimmerChange.feature === 30, `dryer's profile is UNAFFECTED by trimmer's change (got ${JSON.stringify(dryerAfterTrimmerChange)})`);
  assert(flatIronAfterTrimmerChange.motor === 40, `flat_iron's profile is UNAFFECTED by trimmer's change (got ${JSON.stringify(flatIronAfterTrimmerChange)})`);

  console.log("\n[4] Reset to default — deleting a type-specific override falls back to the global default");
  await deleteScoringProfile("trimmer");
  const trimmerAfterReset = await getScoringProfileForToolType("trimmer");
  assert(trimmerAfterReset.motor === 45 && trimmerAfterReset.price === 35 && trimmerAfterReset.feature === 20, `after reset, trimmer falls back to the global default 45/35/20 (got ${JSON.stringify(trimmerAfterReset)})`);

  console.log("\n[5] Validation — all-zero weights rejected");
  let threw = false;
  try {
    await upsertScoringProfile("clipper", { motor: 0, price: 0, feature: 0 });
  } catch (err: any) {
    threw = true;
    assert(err.status === 400, `all-zero weights rejected with a 400-shaped error (got status ${err.status})`);
  }
  assert(threw, "upsertScoringProfile throws for all-zero weights");
  const clipperUnchanged = await getScoringProfileForToolType("clipper");
  assert(clipperUnchanged.motor === 45, "the rejected all-zero attempt never actually wrote — clipper's profile is unchanged");

  console.log("\n[6] Negative weight rejected");
  let threwNegative = false;
  try {
    await upsertScoringProfile("shaver", { motor: -5, price: 35, feature: 20 });
  } catch {
    threwNegative = true;
  }
  assert(threwNegative, "upsertScoringProfile rejects a negative weight");

  console.log("\n[7] Global default itself can be edited");
  await upsertScoringProfile(null, { motor: 50, price: 30, feature: 20 });
  const newDefault = await getScoringProfileForToolType("a_totally_different_custom_type");
  assert(newDefault.motor === 50, `editing the global default (type_key: null) changes what every fallback type resolves to (got ${JSON.stringify(newDefault)})`);
  // Restore for hygiene (other verify scripts may run in the same process
  // if ever combined into a single suite runner).
  await upsertScoringProfile(null, { motor: 45, price: 35, feature: 20 });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
