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

const FAMILIES = [
  makeFamily({ family_key: "rotary", label: "Rotary", aliases: ["rotary motor"], sort_order: 0 }),
  makeFamily({ family_key: "magnetic_vector", label: "Magnetic / Vector", aliases: ["electromagnetic", "vector", "magnetic"], adjacent_families: ["pivot", "linear"], sort_order: 1 }),
  makeFamily({ family_key: "pivot", label: "Pivot", aliases: ["pivot motor"], adjacent_families: ["magnetic_vector"], sort_order: 2 }),
  makeFamily({ family_key: "linear", label: "Linear", aliases: ["linear magnetic"], adjacent_families: ["magnetic_vector"], sort_order: 3 }),
  makeFamily({ family_key: "brushless", label: "Brushless (modifier)", aliases: ["brushless dc", "bldc", "brushless"], modifier: true, sort_order: 4 }),
];

async function main() {
  const { matchMotorFamily, computeMotorMatchTier, isMotorizedCategory } = await import("../lib/motor-taxonomy");

  console.log("\n[1] matchMotorFamily — family + modifier detection");
  const rotary = matchMotorFamily("Powered by a high-torque rotary motor for all-day cutting.", FAMILIES);
  assert(rotary?.familyKey === "rotary", `plain "rotary motor" text resolves to the rotary family (got ${JSON.stringify(rotary)})`);
  assert(rotary?.modifierKey === null, "no modifier detected when the text doesn't mention one");

  const brushlessRotary = matchMotorFamily("Brushless rotary motor delivers consistent power.", FAMILIES);
  assert(brushlessRotary?.familyKey === "rotary", "brushless + rotary resolves family to rotary");
  assert(brushlessRotary?.modifierKey === "brushless", `brushless modifier detected alongside the family (got ${JSON.stringify(brushlessRotary)})`);

  const vectorViaAlias = matchMotorFamily("Uses an advanced electromagnetic drive system.", FAMILIES);
  assert(vectorViaAlias?.familyKey === "magnetic_vector", `"electromagnetic" alias resolves to magnetic_vector (got ${JSON.stringify(vectorViaAlias)})`);

  const pivotMatch = matchMotorFamily("Featuring a precision pivot motor design.", FAMILIES);
  assert(pivotMatch?.familyKey === "pivot", "pivot motor text resolves to the pivot family");

  const noMatch = matchMotorFamily("A lightweight ergonomic handle with soft-touch grip.", FAMILIES);
  assert(noMatch === null, "text with no motor mention returns null, never a guess");

  const modifierAloneNoFamily = matchMotorFamily("This brushless design improves efficiency.", FAMILIES);
  assert(modifierAloneNoFamily === null, "a bare modifier with no family present never resolves to a family on its own");

  console.log("\n[2] computeMotorMatchTier — exact / adjacent / different / unverified");
  assert(computeMotorMatchTier("rotary", "rotary", FAMILIES) === "exact", "same family -> exact");
  assert(computeMotorMatchTier("magnetic_vector", "pivot", FAMILIES) === "adjacent", "magnetic_vector <-> pivot (configured adjacency) -> adjacent");
  assert(computeMotorMatchTier("pivot", "magnetic_vector", FAMILIES) === "adjacent", "adjacency is checked from either side");
  assert(computeMotorMatchTier("rotary", "magnetic_vector", FAMILIES) === "different", "rotary vs magnetic_vector (no adjacency configured) -> different");
  assert(computeMotorMatchTier(null, "rotary", FAMILIES) === "unverified", "our motor type unknown -> unverified, never \"different\"");
  assert(computeMotorMatchTier("rotary", null, FAMILIES) === "unverified", "candidate's motor type unknown -> unverified, never \"different\"");
  assert(computeMotorMatchTier(null, null, FAMILIES) === "unverified", "both unknown -> unverified");

  console.log("\n[3] isMotorizedCategory — reuses the legacy-registry category resolution");
  assert(isMotorizedCategory({ category: "Clippers", subcategory: "Trimmer", targetUser: "pro" }) === true, "clipper/trimmer category is motorized");
  assert(isMotorizedCategory({ category: "Hair Dryers", subcategory: "Blow Dryer", targetUser: "consumer" }) === true, "beauty/dryer category is motorized");
  assert(isMotorizedCategory({ category: "Hair Oil Dispenser", subcategory: "Bottle", targetUser: "pro" }) === false, "a genuinely unrelated category is NOT motorized — never forces the requirement");

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
