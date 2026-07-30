// scripts/verify-motor-taxonomy.ts
// Offline regression check for the motor-type taxonomy's pure logic:
// lib/motor-taxonomy.ts's matchMotorFamily/computeMotorMatchTier/
// isMotorizedCategory. No live OpenAI/Gemini/Rainforest calls — no
// .env.local is loaded, pure synchronous functions only.
//
// Run with: npx tsx scripts/verify-motor-taxonomy.ts

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

function makeFamily(overrides: Partial<any> & { family_key: string; label: string }): any {
  return {
    id: `mfam_${overrides.family_key}`,
    domain: "clipper_trimmer_shaver",
    aliases: [],
    modifier: false,
    adjacent_families: [],
    enabled: true,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Canonical 7-family shape (post Section 25 migration) — "linear" is folded
// into Pivot's own aliases now, not a separate family; adjacency defaults to
// none across the real seed, but a synthetic adjacency pair (magnetic<->pivot)
// is configured here purely to exercise computeMotorMatchTier's adjacency
// mechanism, which the function must still support generically even though
// no production family currently opts into it. Sort order matters: "vector"
// (sort_order 2) is checked before "magnetic" (sort_order 6) so text
// containing the more specific "electromagnetic vector" resolves to Vector
// before Magnetic's own bare "electromagnetic" alias gets a chance to
// match — mirrors the real migration's sort_order (vector kept
// magnetic_vector's original low value; magnetic was appended last).
const FAMILIES = [
  makeFamily({ family_key: "rotary", label: "Rotary Motor", aliases: ["rotary", "rotary motor"], sort_order: 0 }),
  makeFamily({ family_key: "vector", label: "Vector Motor", aliases: ["vector", "in3", "electromagnetic vector"], sort_order: 1 }),
  makeFamily({ family_key: "pivot", label: "Pivot Motor", aliases: ["pivot", "pivot motor", "linear", "linear magnetic"], adjacent_families: ["magnetic"], sort_order: 2 }),
  makeFamily({ family_key: "ac_motor", label: "AC Motor", aliases: ["ac motor", "ac", "alternating current"], sort_order: 3 }),
  makeFamily({ family_key: "dc_motor", label: "DC Motor", aliases: ["dc motor", "dc", "direct current"], sort_order: 4 }),
  makeFamily({ family_key: "brushless", label: "Brushless Motor", aliases: ["brushless", "bldc", "brushless dc", "digital brushless", "eon digital brushless"], sort_order: 5 }),
  makeFamily({ family_key: "magnetic", label: "Magnetic Motor", aliases: ["magnetic", "electromagnetic"], adjacent_families: ["pivot"], sort_order: 6 }),
];

async function main() {
  const { matchMotorFamily, computeMotorMatchTier, isMotorizedCategory } = await import("../lib/motor-taxonomy");

  console.log("\n[1] matchMotorFamily — family + modifier detection");
  const rotary = matchMotorFamily("Powered by a high-torque rotary motor for all-day cutting.", FAMILIES);
  assert(rotary?.familyKey === "rotary", `plain "rotary motor" text resolves to the rotary family (got ${JSON.stringify(rotary)})`);
  assert(rotary?.modifierKey === null, "no modifier detected when the text doesn't mention one");

  const brushlessMotor = matchMotorFamily("Powered by a premium brushless motor for maximum torque.", FAMILIES);
  assert(brushlessMotor?.familyKey === "brushless", `"brushless motor" resolves to the standalone brushless family (got ${JSON.stringify(brushlessMotor)}) — brushless is promoted from modifier to standalone per the canonical 7-family taxonomy`);

  const brandedBrushless = matchMotorFamily("Featuring our EON Digital Brushless Motor technology.", FAMILIES);
  assert(brandedBrushless?.familyKey === "brushless", `branded "EON Digital Brushless Motor" phrasing still resolves generically to Brushless Motor (got ${JSON.stringify(brandedBrushless)})`);

  const vectorViaAlias = matchMotorFamily("Uses an advanced electromagnetic vector drive system.", FAMILIES);
  assert(vectorViaAlias?.familyKey === "vector", `"electromagnetic vector" alias resolves to the vector family (got ${JSON.stringify(vectorViaAlias)})`);

  const magneticViaAlias = matchMotorFamily("Uses an advanced electromagnetic drive system.", FAMILIES);
  assert(magneticViaAlias?.familyKey === "magnetic", `bare "electromagnetic" (no "vector") resolves to the magnetic family (got ${JSON.stringify(magneticViaAlias)})`);

  const pivotMatch = matchMotorFamily("Featuring a precision pivot motor design.", FAMILIES);
  assert(pivotMatch?.familyKey === "pivot", "pivot motor text resolves to the pivot family");

  const linearFoldedIntoPivot = matchMotorFamily("Uses a linear magnetic drive mechanism.", FAMILIES);
  assert(linearFoldedIntoPivot?.familyKey === "pivot", `"linear magnetic" now resolves to Pivot Motor, folded in per the canonical taxonomy (got ${JSON.stringify(linearFoldedIntoPivot)})`);

  const noMatch = matchMotorFamily("A lightweight ergonomic handle with soft-touch grip.", FAMILIES);
  assert(noMatch === null, "text with no motor mention returns null, never a guess");

  console.log("\n[2] computeMotorMatchTier — exact / adjacent / different / unverified");
  assert(computeMotorMatchTier("rotary", "rotary", FAMILIES) === "exact", "same family -> exact");
  assert(computeMotorMatchTier("magnetic", "pivot", FAMILIES) === "adjacent", "magnetic <-> pivot (synthetic configured adjacency, see FAMILIES comment) -> adjacent");
  assert(computeMotorMatchTier("pivot", "magnetic", FAMILIES) === "adjacent", "adjacency is checked from either side");
  assert(computeMotorMatchTier("rotary", "magnetic", FAMILIES) === "different", "rotary vs magnetic (no adjacency configured between them) -> different");
  assert(computeMotorMatchTier("brushless", "vector", FAMILIES) === "different", "no adjacency configured across the real 7-family seed by default -> different");
  assert(computeMotorMatchTier(null, "rotary", FAMILIES) === "unverified", "our motor type unknown -> unverified, never \"different\"");
  assert(computeMotorMatchTier("rotary", null, FAMILIES) === "unverified", "candidate's motor type unknown -> unverified, never \"different\"");
  assert(computeMotorMatchTier(null, null, FAMILIES) === "unverified", "both unknown -> unverified");

  console.log("\n[3] isMotorizedCategory — reuses the legacy-registry category resolution");
  const toolTypes: any[] = [
    { id: "t1", type_key: "clipper", label: "Clipper", aliases: ["clipper"], family: "clipper_trimmer_shaver", enabled: true, custom: false, sort_order: 0 },
    { id: "t2", type_key: "dryer", label: "Hair Dryer", aliases: ["dryer"], family: "beauty", enabled: true, custom: false, sort_order: 1 },
  ];
  assert(isMotorizedCategory({ category: "Clippers", subcategory: "Trimmer", targetUser: "pro", toolType: "clipper" }, toolTypes) === true, "clipper/trimmer category is motorized");
  assert(isMotorizedCategory({ category: "Hair Dryers", subcategory: "Blow Dryer", targetUser: "consumer", toolType: "dryer" }, toolTypes) === true, "beauty/dryer category is motorized");
  assert(isMotorizedCategory({ category: "Hair Oil Dispenser", subcategory: "Bottle", targetUser: "pro", toolType: null }, toolTypes) === false, "a genuinely unrelated category is NOT motorized — never forces the requirement");

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
