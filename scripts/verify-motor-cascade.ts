// scripts/verify-motor-cascade.ts
// Offline regression check for the motor-extraction cascade additions:
// title scanning (previously not scanned at all) and the branded-motor-name
// map (a brand's own proprietary marketing name, e.g. "IN3" -> vector,
// matched only for the brand that owns it — never a global alias). No
// live API calls — extractCompetitorMotorType/matchBrandedMotorName are
// pure functions.
//
// Run with: npx tsx scripts/verify-motor-cascade.ts

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
  const { extractCompetitorMotorType } = await import("../lib/motor-extraction");
  const { matchBrandedMotorName } = await import("../lib/motor-taxonomy");

  const FAMILIES: any[] = [
    { id: "1", family_key: "vector", label: "Vector Motor", domain: "clipper_trimmer_shaver", aliases: ["electromagnetic", "vector", "magnetic"], modifier: false, adjacent_families: ["pivot"], enabled: true, sort_order: 0 },
    { id: "2", family_key: "rotary", label: "Rotary Motor", domain: "clipper_trimmer_shaver", aliases: ["rotary motor"], modifier: false, adjacent_families: [], enabled: true, sort_order: 1 },
    { id: "3", family_key: "pivot", label: "Pivot Motor", domain: "clipper_trimmer_shaver", aliases: ["pivot motor"], modifier: false, adjacent_families: ["vector"], enabled: true, sort_order: 2 },
  ];

  console.log("\n[1] Title scanning — previously not scanned at all");
  {
    const withMotorOnlyInTitle = extractCompetitorMotorType(
      { title: "ProBrand Vector Motor Trimmer 2000", feature_bullets: ["Lightweight design", "Long battery life"], description: "A great trimmer for everyday use." },
      FAMILIES
    );
    assert(withMotorOnlyInTitle?.familyKey === "vector", `motor mentioned only in the title resolves correctly (got ${withMotorOnlyInTitle?.familyKey})`);
    assert(withMotorOnlyInTitle?.confirmedVia === "title", `confirmedVia correctly reports "title" (got ${withMotorOnlyInTitle?.confirmedVia})`);
    assert(withMotorOnlyInTitle?.sourceQuote === "ProBrand Vector Motor Trimmer 2000", "sourceQuote is the verbatim title");
  }

  console.log("\n[2] Existing cascade steps still resolve correctly with confirmedVia labels");
  {
    const specMatch = extractCompetitorMotorType(
      { specifications: [{ name: "Motor Type", value: "Rotary" }] },
      FAMILIES
    );
    assert(specMatch?.familyKey === "rotary" && specMatch?.confirmedVia === "spec_table", `spec-table match labeled "spec_table" (got ${specMatch?.confirmedVia})`);

    const bulletMatch = extractCompetitorMotorType(
      { feature_bullets: ["Powerful pivot motor for precision cutting"] },
      FAMILIES
    );
    assert(bulletMatch?.familyKey === "pivot" && bulletMatch?.confirmedVia === "bullets", `feature-bullet match labeled "bullets" (got ${bulletMatch?.confirmedVia})`);

    const descMatch = extractCompetitorMotorType(
      { description: "This product is not motorized in the usual sense. It uses a magnetic vector drive for consistent power." },
      FAMILIES
    );
    assert(descMatch?.familyKey === "vector" && descMatch?.confirmedVia === "description", `description-sentence match labeled "description" (got ${descMatch?.confirmedVia})`);

    const noMatch = extractCompetitorMotorType({ title: "Just a generic accessory", description: "Nothing motor-related here at all." }, FAMILIES);
    assert(noMatch === null, "no match anywhere correctly resolves to null (never a guess)");
  }

  console.log("\n[3] Branded motor name map — brand-scoped, never a global alias");
  const BRANDED_NAMES: any[] = [
    { id: "b1", brand_name: "Wahl", branded_term: "IN3", family_key: "vector", enabled: true, sort_order: 0 },
    { id: "b2", brand_name: "Wahl", branded_term: "5-Star Series", family_key: "rotary", enabled: false, sort_order: 1 }, // disabled — must never match
  ];
  {
    const matched = matchBrandedMotorName("Wahl", "The Wahl IN3 delivers unmatched power.", BRANDED_NAMES, FAMILIES);
    assert(matched?.familyKey === "vector", `"IN3" resolves to Vector Motor for Wahl (got ${matched?.familyKey})`);
    assert(matched?.brandedTerm === "IN3", `matchBrandedMotorName surfaces the matched branded term itself (got ${matched?.brandedTerm})`);

    const wrongBrand = matchBrandedMotorName("Andis", "This Andis IN3 model is great.", BRANDED_NAMES, FAMILIES);
    assert(wrongBrand === null, "the same term does NOT match for a different brand — proprietary names are brand-scoped, never global aliases");

    const disabledEntry = matchBrandedMotorName("Wahl", "Featuring the 5-Star Series motor.", BRANDED_NAMES, FAMILIES);
    assert(disabledEntry === null, "a disabled branded-name entry is never matched");

    const noBrand = matchBrandedMotorName("", "IN3 mentioned with no brand given.", BRANDED_NAMES, FAMILIES);
    assert(noBrand === null, "an empty/missing brand never matches anything");
  }

  console.log("\n[4] extractCompetitorMotorType checks the branded map FIRST, before generic aliases");
  {
    // "IN3" alone doesn't match any generic family alias, but the branded
    // map resolves it for Wahl specifically — proving the branded-map path
    // is actually wired into the main extraction cascade, not just a
    // standalone function nobody calls.
    const result = extractCompetitorMotorType(
      { title: "Wahl IN3 Cordless Trimmer", feature_bullets: [] },
      FAMILIES,
      { brand: "Wahl", brandedNames: BRANDED_NAMES }
    );
    assert(result?.familyKey === "vector" && result?.confirmedVia === "branded_map", `branded map resolves through the full extraction cascade (got familyKey=${result?.familyKey}, confirmedVia=${result?.confirmedVia})`);
    assert(result?.brandedName === "IN3", `extractCompetitorMotorType surfaces the branded term as motor_branded_name (got ${result?.brandedName})`);

    const noBrandedNames = extractCompetitorMotorType({ title: "Wahl IN3 Cordless Trimmer", feature_bullets: [] }, FAMILIES);
    assert(noBrandedNames === null, "omitting brandedNames entirely degrades gracefully (no crash, no false match) since 'IN3' isn't a generic alias");

    const genericMatchNoBrandedName = extractCompetitorMotorType({ title: "ProBrand Vector Motor Trimmer 2000" }, FAMILIES);
    assert(genericMatchNoBrandedName?.brandedName === null, `a plain generic-alias match (no branded map hit) leaves brandedName null (got ${genericMatchNoBrandedName?.brandedName})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
