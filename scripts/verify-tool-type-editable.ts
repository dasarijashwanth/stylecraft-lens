// scripts/verify-tool-type-editable.ts
// Offline regression check for Tool Type's migration from a fixed
// compile-time TypeScript union to a DB-backed, user-editable shape
// (lib/db/tool-types.ts's tool_types table). Confirms:
// [1] resolveToolType/assertToolType behave identically for built-in types
//     when driven by the new DB-backed list (no behavior change vs. the
//     old fixed-union implementation).
// [2] A custom type ("Foil Shaper", added inline like a real user would)
//     resolves from text and rejects cross-type contamination with the
//     SAME strictness as a built-in — never weaker isolation just because
//     it's user-added.
// [3] lib/legacy-brand-registry.ts's resolveFamily() explicit-family-first
//     fix: a custom type's own `family` column routes it to the correct
//     curated brand list even though its category text contains none of
//     the sniffed keywords (the latent gap this fix closes).
//
// No live API calls — every function under test here is pure/synchronous.
//
// Run with: npx tsx scripts/verify-tool-type-editable.ts

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

// Mirrors the 9 built-in rows seeded by supabase_schema.sql's Section 28 /
// lib/memoryDb.ts's seedToolTypeDefaults, plus one custom type appended
// exactly as the "+ Add new tool type…" form flow would create it.
function makeToolTypes(): any[] {
  return [
    { id: "t1", type_key: "trimmer", label: "Trimmer", aliases: ["trimmer", "beard trimmer", "detailer", "outliner", "liner", "edger"], family: "clipper_trimmer_shaver", enabled: true, custom: false, sort_order: 0 },
    { id: "t2", type_key: "shaver", label: "Shaver", aliases: ["shaver", "foil shaver", "rotary shaver", "electric shaver", "razor"], family: "clipper_trimmer_shaver", enabled: true, custom: false, sort_order: 1 },
    { id: "t3", type_key: "dryer", label: "Hair Dryer", aliases: ["dryer", "blow dryer", "diffuser"], family: "beauty", enabled: true, custom: false, sort_order: 2 },
    { id: "t4", type_key: "flat_iron", label: "Flat Iron", aliases: ["flat iron", "straightener", "hair iron"], family: "beauty", enabled: true, custom: false, sort_order: 3 },
    { id: "t5", type_key: "curling_iron", label: "Curling Iron", aliases: ["curling iron", "curling wand", "curler", "wand"], family: "beauty", enabled: true, custom: false, sort_order: 4 },
    { id: "t6", type_key: "hot_brush", label: "Hot Brush", aliases: ["hot brush", "styling brush", "heated brush"], family: "beauty", enabled: true, custom: false, sort_order: 5 },
    { id: "t7", type_key: "clipper", label: "Clipper", aliases: ["clipper"], family: "clipper_trimmer_shaver", enabled: true, custom: false, sort_order: 6 },
    { id: "t8", type_key: "other_styling", label: "Other Styling Tool", aliases: [], family: "beauty", enabled: true, custom: false, sort_order: 7 },
    { id: "t9", type_key: "combo", label: "Combo / Multi-Tool Kit", aliases: [], family: null, enabled: true, custom: false, sort_order: 8 },
    // Custom type added inline, e.g. for a newly-launched product line —
    // same shape a real POST /api/tool-types response returns.
    { id: "t10", type_key: "foil_shaper", label: "Foil Shaper", aliases: ["foil shaper", "shaper blade"], family: "clipper_trimmer_shaver", enabled: true, custom: true, sort_order: 9 },
  ];
}

async function main() {
  const { resolveToolType, assertToolType, getToolTypeLabel, toolTypesForIndustry } = await import("../lib/tool-type-taxonomy");
  const { resolveRegistryCategorySlug } = await import("../lib/legacy-brand-registry");

  const toolTypes = makeToolTypes();

  console.log("\n[1] Built-in types behave identically under the new DB-backed list");
  assert(resolveToolType("Wahl Professional Cordless Detailer Trimmer", toolTypes)?.type === "trimmer", "plain trimmer title still resolves to trimmer");
  assert(resolveToolType("Andis Master Clipper", toolTypes)?.type === "clipper", "plain clipper title still resolves to clipper");
  assert(resolveToolType("BaByliss Foil Shaver Pro", toolTypes)?.type === "shaver", "foil shaver alias still resolves to shaver (not confused with the new 'Foil Shaper' custom type)");
  assert(resolveToolType("Wahl Clipper & Trimmer Combo Kit", toolTypes)?.type === "combo", "explicit combo phrase still resolves to combo");
  assert(assertToolType("Andis Master Clipper", "trimmer", toolTypes).ok === false, "clipper candidate still REJECTED for a trimmer-required slot");
  assert(assertToolType("Andis Master Clipper", "clipper", toolTypes).ok === true, "clipper candidate still passes for a clipper-required slot");
  assert(getToolTypeLabel("trimmer", toolTypes) === "Trimmer", "getToolTypeLabel resolves a built-in's real label");

  console.log("\n[2] A custom type resolves and rejects contamination with the SAME strictness as a built-in");
  const customResolved = resolveToolType("StyleCraft Precision Foil Shaper 3000", toolTypes);
  assert(customResolved?.type === "foil_shaper", `custom type's own alias resolves it correctly (got ${JSON.stringify(customResolved)})`);
  assert(getToolTypeLabel("foil_shaper", toolTypes) === "Foil Shaper", "getToolTypeLabel resolves the custom type's real label, not a raw key fallback");

  const customAcceptsOwnType = assertToolType("StyleCraft Precision Foil Shaper 3000", "foil_shaper", toolTypes);
  assert(customAcceptsOwnType.ok === true, "a foil-shaper candidate passes for a foil-shaper-required slot");

  const clipperRejectedAsFoilShaper = assertToolType("Andis Master Clipper", "foil_shaper", toolTypes);
  assert(clipperRejectedAsFoilShaper.ok === false, "a clipper candidate is REJECTED for a foil-shaper-required slot — custom types gate exactly like built-ins");
  assert(clipperRejectedAsFoilShaper.reason === "tool_type_mismatch", "rejection reason is tool_type_mismatch");

  const foilShaperRejectedAsClipper = assertToolType("StyleCraft Precision Foil Shaper 3000", "clipper", toolTypes);
  assert(foilShaperRejectedAsClipper.ok === false, "the reverse direction also rejects — a foil-shaper candidate never fills a clipper-required slot");

  const comboRejectsCustomType = resolveToolType("StyleCraft Foil Shaper & Trimmer Combo Kit", toolTypes);
  assert(comboRejectsCustomType?.type === "combo", "combo signal phrases still win over the custom type's own alias, same precedence as built-ins");

  console.log("\n[3] toolTypesForIndustry includes the custom type under its assigned industry, never the other");
  const groomingOpts = toolTypesForIndustry("grooming-barbering", toolTypes);
  const beautyOpts = toolTypesForIndustry("haircare-styling", toolTypes);
  assert(groomingOpts.some(t => t.type_key === "foil_shaper"), "the custom type (family: clipper_trimmer_shaver) appears under Grooming & Barbering");
  assert(!beautyOpts.some(t => t.type_key === "foil_shaper"), "the custom type does NOT appear under Hair Care & Styling");
  assert(groomingOpts.some(t => t.type_key === "combo") && beautyOpts.some(t => t.type_key === "combo"), "combo (family: null) appears under BOTH industries");

  console.log("\n[4] resolveFamily's explicit-family-first fix — the latent routing gap this phase closes");
  const customTypeNoKeywords = resolveRegistryCategorySlug(
    { category: "Precision Grooming Line", subcategory: "Model X", targetUser: "pro", toolType: "foil_shaper" } as any,
    toolTypes
  );
  assert(
    customTypeNoKeywords === "legacy_professional_clippers",
    `a custom type's category text ("Precision Grooming Line"/"Model X") contains NONE of the sniffed keywords, but its own family column still routes it to the correct curated brand list (got ${customTypeNoKeywords})`
  );

  const builtInStillWorks = resolveRegistryCategorySlug(
    { category: "Hair Dryers", subcategory: "Ionic Dryer", targetUser: "consumer", toolType: "dryer" } as any,
    toolTypes
  );
  assert(builtInStillWorks === "retail_beauty", "a built-in type's own family column also routes correctly (not just a custom-type accommodation)");

  const noToolTypeFallsBackToKeywords = resolveRegistryCategorySlug(
    { category: "Hair Dryers", subcategory: "Ionic Dryer", targetUser: "consumer" },
    toolTypes
  );
  assert(noToolTypeFallsBackToKeywords === "retail_beauty", "omitting toolType entirely still falls back to category-text keyword sniffing, unchanged from before this fix");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
