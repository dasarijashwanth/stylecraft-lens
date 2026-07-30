// scripts/verify-normalize-motor.ts
// Offline regression check for lib/motor-taxonomy.ts's unified
// normalizeMotor() entry point — the single function every motor-entry
// point (form, extraction, matching) should call instead of invoking
// matchBrandedMotorName/matchMotorFamily separately. No live API calls —
// pure functions only.
//
// Run with: npx tsx scripts/verify-normalize-motor.ts

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

// Canonical 7-family shape (post Section 25 migration) — same fixture
// convention as scripts/verify-motor-taxonomy.ts.
const FAMILIES = [
  makeFamily({ family_key: "rotary", label: "Rotary Motor", aliases: ["rotary", "rotary motor"], sort_order: 0 }),
  makeFamily({ family_key: "vector", label: "Vector Motor", aliases: ["vector", "in3", "electromagnetic vector"], sort_order: 1 }),
  makeFamily({ family_key: "pivot", label: "Pivot Motor", aliases: ["pivot", "pivot motor", "linear", "linear magnetic"], sort_order: 2 }),
  makeFamily({ family_key: "ac_motor", label: "AC Motor", aliases: ["ac motor", "ac", "alternating current"], sort_order: 3 }),
  makeFamily({ family_key: "dc_motor", label: "DC Motor", aliases: ["dc motor", "dc", "direct current"], sort_order: 4 }),
  makeFamily({ family_key: "brushless", label: "Brushless Motor", aliases: ["brushless", "bldc", "brushless dc", "digital brushless", "eon digital brushless"], sort_order: 5 }),
  makeFamily({ family_key: "magnetic", label: "Magnetic Motor", aliases: ["magnetic", "electromagnetic"], sort_order: 6 }),
];

// "TurboVector Pro" (not "IN3") is deliberately used for the brand-scoping
// tests below — the canonical taxonomy's own seeded aliases (per the user's
// spec) already include "IN3" as a GENERIC Vector Motor alias (see
// Section 25's migration), so it resolves for ANY brand and isn't a useful
// fixture for proving brand-scoped isolation. A wholly fictional proprietary
// term with zero generic-alias overlap is the only way to isolate that path.
const BRANDED_NAMES: any[] = [
  { id: "b1", brand_name: "Wahl", branded_term: "TurboVector Pro", family_key: "vector", enabled: true, sort_order: 0 },
  { id: "b2", brand_name: "StyleCraft", branded_term: "EON Digital Brushless Motor", family_key: "brushless", enabled: true, sort_order: 1 },
];

async function main() {
  const { normalizeMotor } = await import("../lib/motor-taxonomy");

  console.log("\n[1] Own-product path (no brand given) — falls straight to generic family matching");
  const ownProductBrushless = normalizeMotor("EON Digital Brushless Motor", FAMILIES);
  assert(ownProductBrushless.family?.familyKey === "brushless", `"EON Digital Brushless Motor" resolves generically to Brushless Motor with no brand needed (got ${JSON.stringify(ownProductBrushless)})`);
  assert(ownProductBrushless.brandedName === null, "no brand given -> brandedName is null even though a family matched");

  const ownProductVector = normalizeMotor("IN2 Vector Motor", FAMILIES);
  assert(ownProductVector.family?.familyKey === "vector", `"IN2 Vector Motor" resolves generically to Vector Motor (got ${JSON.stringify(ownProductVector)})`);

  const ownProductNoMatch = normalizeMotor("Super-Torque Motor", FAMILIES);
  assert(ownProductNoMatch.family === null, "an unrecognized phrase resolves to null, never a guess");
  assert(ownProductNoMatch.brandedName === null, "brandedName is null when nothing resolved");

  console.log("\n[2] Competitor path (brand given) — branded map checked first");
  const competitorBranded = normalizeMotor("The Wahl TurboVector Pro delivers unmatched power.", FAMILIES, { brand: "Wahl", brandedNames: BRANDED_NAMES });
  assert(competitorBranded.family?.familyKey === "vector", `Wahl's "TurboVector Pro" resolves via the branded map to Vector Motor (got ${JSON.stringify(competitorBranded)})`);
  assert(competitorBranded.brandedName === "TurboVector Pro", `brandedName surfaces the brand's own registered term (got ${competitorBranded.brandedName})`);

  const wrongBrandNoMatch = normalizeMotor("The Andis TurboVector Pro delivers unmatched power.", FAMILIES, { brand: "Andis", brandedNames: BRANDED_NAMES });
  assert(wrongBrandNoMatch.family === null, "the same proprietary term does NOT match for a brand that doesn't own it — falls through to generic matching, which also fails since 'TurboVector Pro' isn't a generic alias either");

  const bareIn3IsGeneric = normalizeMotor("Features the IN3 system.", FAMILIES, { brand: "Andis", brandedNames: BRANDED_NAMES });
  assert(bareIn3IsGeneric.family?.familyKey === "vector", `"IN3" is a GENERIC Vector Motor alias per the canonical taxonomy (any brand) — resolves regardless of brand (got ${JSON.stringify(bareIn3IsGeneric)})`);
  assert(bareIn3IsGeneric.brandedName === null, "generic-alias resolution never sets brandedName, even when a brand was given");

  console.log("\n[3] A competitor's own generic alias still resolves even when brandedNames is given but doesn't match this text");
  const competitorGeneric = normalizeMotor("Powered by a rotary motor for all-day cutting.", FAMILIES, { brand: "Wahl", brandedNames: BRANDED_NAMES });
  assert(competitorGeneric.family?.familyKey === "rotary", `generic "rotary motor" resolves even with a brand+brandedNames given (got ${JSON.stringify(competitorGeneric)})`);
  assert(competitorGeneric.brandedName === null, "brandedName is null when resolution fell through to generic matching, not the branded map");

  console.log("\n[4] Linear folds into Pivot Motor per the canonical taxonomy");
  const linearFold = normalizeMotor("Uses a linear magnetic drive mechanism.", FAMILIES);
  assert(linearFold.family?.familyKey === "pivot", `"linear magnetic" resolves to Pivot Motor (got ${JSON.stringify(linearFold)})`);

  console.log("\n[5] Empty/whitespace input never throws, always resolves to null cleanly");
  assert(normalizeMotor("", FAMILIES).family === null, "empty string resolves to null");
  assert(normalizeMotor("   ", FAMILIES).family === null, "whitespace-only string resolves to null");
  assert(normalizeMotor("", FAMILIES, { brand: "Wahl", brandedNames: BRANDED_NAMES }).family === null, "empty string with brand+brandedNames given still resolves to null, no crash");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
