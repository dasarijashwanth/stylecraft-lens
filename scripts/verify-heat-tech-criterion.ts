// scripts/verify-heat-tech-criterion.ts
// Offline regression check for Fix 3 (motorless categories get a criterion
// swap) — no live OpenAI/Gemini/Rainforest/Supabase calls, no .env.local
// loaded, so every DB-backed helper below runs against memoryDb's real
// seeded defaults (heat_tech_families, tool_types.primary_criterion).
//
// Covers, in order:
// [1] resolvePrimaryCriterion — flat_iron/curling_iron/hot_brush resolve
//     'heat_technology'; clipper/trimmer/shaver/dryer resolve 'motor';
//     other_styling/combo resolve 'none'. This is the exact fix for the
//     regression verify-guaranteed-ten-competitors.ts caught (other_styling
//     wrongly triggering a motor pause-and-ask via the old family-based
//     isMotorizedCategory gate).
// [2] selectByCompositeScore for a flat-iron identity — heat_tech_* fields
//     populated from forwarded specs/bullets, motor_* fields ABSENT
//     entirely (not just null — the key itself must not exist).
// [3] selectByCompositeScore for a motorized identity (clipper) — UNCHANGED
//     behavior, motor_* present, heat_tech_* absent (regression guard —
//     Fix 3 must not touch the existing motor cascade at all).
// [4] selectByCompositeScore for a 'none'-criterion identity
//     (other_styling) — neither field set is populated, and
//     requireMotorEvidenceFirst never holds a candidate back waiting for a
//     criterion that doesn't apply to this tool type.
// [5] buildPhase1Prompt/buildPhase2Prompt for a flat-iron identity — zero
//     literal "motor" substrings anywhere in the generated prompt text,
//     and the resolved heat-tech label + "plate/heat technology" wording
//     DOES appear in the combined discovery instruction.
// [6] buildPhase1Prompt for a 'none'-criterion identity — neither "motor"
//     nor "plate/heat" appears; the criterion clause is dropped entirely.
// [7] lib/heat-tech-taxonomy.ts / lib/heat-tech-extraction.ts — the
//     5-step competitor cascade and the 4-step "our own product" cascade,
//     in isolation.
//
// Run with: npx tsx scripts/verify-heat-tech-criterion.ts

export {};

process.env.RAINFOREST_API_KEY = "test-key-not-a-real-credential";

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

const TARGET_PRICE = 89.95;

// Mirrors lib/memoryDb.ts's seedToolTypeDefaults exactly (the real
// production seed, including primary_criterion) — used everywhere this
// script needs a ToolTypeRow[].
function makeToolTypesFixture(): any[] {
  const now = new Date().toISOString();
  const defs: { key: string; label: string; aliases: string[]; family: string | null; primaryCriterion: "motor" | "heat_technology" | "none" }[] = [
    { key: "trimmer", label: "Trimmer", aliases: ["trimmer", "beard trimmer"], family: "clipper_trimmer_shaver", primaryCriterion: "motor" },
    { key: "shaver", label: "Shaver", aliases: ["shaver", "electric shaver"], family: "clipper_trimmer_shaver", primaryCriterion: "motor" },
    { key: "dryer", label: "Hair Dryer", aliases: ["dryer", "blow dryer"], family: "beauty", primaryCriterion: "motor" },
    { key: "flat_iron", label: "Flat Iron", aliases: ["flat iron", "straightener", "hair iron"], family: "beauty", primaryCriterion: "heat_technology" },
    { key: "curling_iron", label: "Curling Iron", aliases: ["curling iron", "curling wand", "curler", "wand"], family: "beauty", primaryCriterion: "heat_technology" },
    { key: "hot_brush", label: "Hot Brush", aliases: ["hot brush", "styling brush", "heated brush"], family: "beauty", primaryCriterion: "heat_technology" },
    { key: "clipper", label: "Clipper", aliases: ["clipper"], family: "clipper_trimmer_shaver", primaryCriterion: "motor" },
    { key: "other_styling", label: "Other Styling Tool", aliases: [], family: "beauty", primaryCriterion: "none" },
    { key: "combo", label: "Combo / Multi-Tool Kit", aliases: [], family: null, primaryCriterion: "none" },
  ];
  return defs.map((d, i) => ({
    id: `ttype_${d.key}`, type_key: d.key, label: d.label, aliases: d.aliases, family: d.family,
    primary_criterion: d.primaryCriterion,
    enabled: true, custom: false, sort_order: i, created_at: now, updated_at: now,
  }));
}
const TOOL_TYPES = makeToolTypesFixture();

// Mirrors lib/memoryDb.ts's seedHeatTechFamilyDefaults exactly.
function makeHeatTechFamiliesFixture(): any[] {
  const now = new Date().toISOString();
  const defs = [
    { key: "titanium", label: "Titanium", aliases: ["titanium", "titanium plates", "titanium-coated", "titanium coated"] },
    { key: "ceramic", label: "Ceramic", aliases: ["ceramic", "ceramic plates", "ceramic-coated", "ceramic coated"] },
    { key: "tourmaline", label: "Tourmaline", aliases: ["tourmaline", "tourmaline plates", "tourmaline-ceramic", "tourmaline ceramic"] },
    { key: "ionic", label: "Ionic", aliases: ["ionic", "ion technology", "negative ion"] },
  ];
  return defs.map((d, i) => ({
    id: `htfam_${d.key}`, family_key: d.key, label: d.label, aliases: d.aliases,
    enabled: true, sort_order: i, created_at: now, updated_at: now,
  }));
}
const HEAT_TECH_FAMILIES = makeHeatTechFamiliesFixture();

const FLAT_IRON_IDENTITY: any = {
  productName: "Apex Titanium Flat Iron",
  brand: "Apex",
  category: "Styling Tools",
  subcategory: "Flat Iron",
  whatItIs: "A professional titanium-plate flat iron",
  keyAttributes: ["1-inch plates"],
  targetUser: "both",
  priceObserved: { value: TARGET_PRICE, currency: "USD", source: "form" },
  confidence: "high",
  evidence: [],
  identityStatus: "verified",
  toolType: "flat_iron",
};

const CLIPPER_IDENTITY: any = {
  productName: "Apex Pro Clipper",
  brand: "Apex",
  category: "Clippers",
  subcategory: "Professional Clipper",
  whatItIs: "A cordless professional clipper",
  keyAttributes: ["high torque"],
  targetUser: "both",
  priceObserved: { value: 179.95, currency: "USD", source: "form" },
  confidence: "high",
  evidence: [],
  identityStatus: "verified",
  toolType: "clipper",
};

const OTHER_STYLING_IDENTITY: any = {
  productName: "Apex Detangling Comb",
  brand: "Apex",
  category: "Styling Tools",
  subcategory: "Comb",
  whatItIs: "A wide-tooth detangling comb",
  keyAttributes: [],
  targetUser: "both",
  priceObserved: { value: 12.95, currency: "USD", source: "form" },
  confidence: "high",
  evidence: [],
  identityStatus: "verified",
  toolType: "other_styling",
};

async function main() {
  const { resolvePrimaryCriterion, selectByCompositeScore, buildPhase1Prompt, buildPhase2Prompt } = await import("../lib/analysisEngine");
  const { extractCompetitorHeatTech, resolveOurHeatTech } = await import("../lib/heat-tech-extraction");
  const { computeHeatTechMatchTier, normalizeHeatTech } = await import("../lib/heat-tech-taxonomy");

  console.log("\n[1] resolvePrimaryCriterion — motorized/heat-tech/none tool types resolve correctly");
  assert(resolvePrimaryCriterion(FLAT_IRON_IDENTITY, TOOL_TYPES) === "heat_technology", "flat_iron resolves 'heat_technology'");
  assert(resolvePrimaryCriterion({ ...FLAT_IRON_IDENTITY, toolType: "curling_iron" }, TOOL_TYPES) === "heat_technology", "curling_iron resolves 'heat_technology'");
  assert(resolvePrimaryCriterion({ ...FLAT_IRON_IDENTITY, toolType: "hot_brush" }, TOOL_TYPES) === "heat_technology", "hot_brush resolves 'heat_technology'");
  assert(resolvePrimaryCriterion(CLIPPER_IDENTITY, TOOL_TYPES) === "motor", "clipper resolves 'motor' (unchanged)");
  assert(resolvePrimaryCriterion({ ...CLIPPER_IDENTITY, toolType: "dryer" }, TOOL_TYPES) === "motor", "dryer resolves 'motor' — the exact regression fixed this session (dryer is genuinely motorized despite sharing family:'beauty' with flat_iron)");
  assert(resolvePrimaryCriterion(OTHER_STYLING_IDENTITY, TOOL_TYPES) === "none", "other_styling resolves 'none'");
  assert(resolvePrimaryCriterion({ ...OTHER_STYLING_IDENTITY, toolType: "combo" }, TOOL_TYPES) === "none", "combo resolves 'none'");

  console.log("\n[2] selectByCompositeScore — flat-iron identity runs the heat-tech cascade, motor_* fields absent entirely");
  {
    const ourHeatTech = { familyKey: "titanium", label: "Titanium", source: "heat_tech_family_field" as const };

    const groundedTitaniumIron = {
      name: "Andis Titan Flat Iron", brand: "Andis", price_raw: 84.99,
      specifications: [{ name: "Plate Material", value: "Titanium" }],
      feature_bullets: ["1-inch titanium plates for even heat distribution"],
      description: "",
    };
    const ungroundedIron = {
      name: "BaBylissPRO NoGround Iron", brand: "BaByliss", price_raw: 89.0,
    };
    const differentTechIron = {
      name: "Gamma+ Ceramic Iron", brand: "Gamma+", price_raw: 87.0,
      specifications: [{ name: "Plate Material", value: "Ceramic" }],
      feature_bullets: ["Smooth ceramic plates"],
      description: "",
    };

    const ctx: any = {
      motorFamilies: [], toolTypes: TOOL_TYPES,
      primaryCriterion: "heat_technology", ourMotor: null,
      heatTechFamilies: HEAT_TECH_FAMILIES, brandedHeatTechNames: [], ourHeatTech,
      ourSpecs: { rpm: null, runTimeMinutes: null, cordless: null, buildMaterial: null, bladeTech: null, heaterType: null, maxTempClass: null },
      weights: { motor: 40, price: 35, feature: 25 },
    };

    const scored = selectByCompositeScore(
      [groundedTitaniumIron, ungroundedIron, differentTechIron],
      TARGET_PRICE, "legacy", FLAT_IRON_IDENTITY, 5, ctx
    );

    const grounded = scored.find((c: any) => c.name === groundedTitaniumIron.name);
    const ungrounded = scored.find((c: any) => c.name === ungroundedIron.name);
    const differentTech = scored.find((c: any) => c.name === differentTechIron.name);

    assert(!!grounded && grounded.heat_tech_match_tier === "exact", `grounded candidate resolves heat_tech_match_tier "exact" via forwarded specs (got ${grounded?.heat_tech_match_tier})`);
    assert(!!ungrounded && ungrounded.heat_tech_match_tier === "unverified", `candidate with zero grounding data resolves "unverified" (got ${ungrounded?.heat_tech_match_tier})`);
    assert(!!differentTech && differentTech.heat_tech_match_tier === "different", `grounded-but-different-family candidate resolves "different" (got ${differentTech?.heat_tech_match_tier})`);
    assert(!!grounded && grounded.heat_tech_type === "Titanium", `grounded candidate's heat_tech_type is "Titanium" (got ${grounded?.heat_tech_type})`);

    for (const c of scored) {
      assert(!("motor_type" in c) && !("motor_match_tier" in c) && !("motor_score" in c), `${c.name}: motor_* fields are entirely absent for a heat_technology-criterion competitor (Motor must never appear anywhere for motorless types)`);
    }
  }

  console.log("\n[3] selectByCompositeScore — a motorized identity (clipper) is UNCHANGED: motor_* present, heat_tech_* absent");
  {
    const ourMotor = { familyKey: "vector", label: "Vector Motor", modifierKey: null, modifierLabel: null, source: "motor_tech_field" as const };
    const groundedVectorClipper = {
      name: "Andis Vector Clipper", brand: "Andis", price_raw: 174.99,
      specifications: [{ name: "Motor Type", value: "Vector Motor" }],
      feature_bullets: ["All-metal housing"],
      description: "",
    };
    const ctx: any = {
      motorFamilies: [{ id: "mf1", family_key: "vector", label: "Vector Motor", aliases: ["vector"], modifier: null, adjacent_families: [], enabled: true, sort_order: 0 }],
      toolTypes: TOOL_TYPES,
      primaryCriterion: "motor", ourMotor, ourHeatTech: null,
      heatTechFamilies: HEAT_TECH_FAMILIES, brandedHeatTechNames: [],
      ourSpecs: { rpm: null, runTimeMinutes: null, cordless: null, buildMaterial: null, bladeTech: null },
      weights: { motor: 45, price: 35, feature: 20 },
    };
    const scored = selectByCompositeScore([groundedVectorClipper], CLIPPER_IDENTITY.priceObserved.value, "legacy", CLIPPER_IDENTITY, 5, ctx);
    const c = scored[0];
    assert(!!c && c.motor_match_tier === "exact", `motorized identity still resolves motor_match_tier "exact" via forwarded specs (got ${c?.motor_match_tier})`);
    assert(!!c && c.motor_type === "Vector Motor", `motor_type is populated as before (got ${c?.motor_type})`);
    assert(!("heat_tech_type" in c) && !("heat_tech_match_tier" in c), "heat_tech_* fields are entirely absent for a motor-criterion competitor");
  }

  console.log("\n[4] selectByCompositeScore — a 'none'-criterion identity (other_styling) sets neither field set, never held back by requireMotorEvidenceFirst");
  {
    const plainComb = { name: "Andis Detangling Comb", brand: "Andis", price_raw: 11.99 };
    const ctx: any = {
      motorFamilies: [], toolTypes: TOOL_TYPES,
      primaryCriterion: "none", ourMotor: null, ourHeatTech: null,
      heatTechFamilies: HEAT_TECH_FAMILIES, brandedHeatTechNames: [],
      ourSpecs: { rpm: null, runTimeMinutes: null, cordless: null, buildMaterial: null, bladeTech: null },
      weights: { motor: 0, price: 60, feature: 40 },
    };
    const scored = selectByCompositeScore([plainComb], OTHER_STYLING_IDENTITY.priceObserved.value, "legacy", OTHER_STYLING_IDENTITY, 5, ctx, { requireMotorEvidenceFirst: true });
    const c = scored[0];
    assert(!!c, "the candidate survives selection");
    assert(!("motor_type" in c) && !("motor_match_tier" in c), "motor_* fields absent for a 'none'-criterion competitor");
    assert(!("heat_tech_type" in c) && !("heat_tech_match_tier" in c), "heat_tech_* fields absent for a 'none'-criterion competitor");
    assert(!c.motor_unverified_fallback, "never tagged as an unverified-evidence fallback pick — 'none' types are never held back waiting for a criterion that doesn't apply");
  }

  console.log("\n[5] buildPhase1Prompt/buildPhase2Prompt — flat-iron identity: zero \"motor\" anywhere, heat-tech label + wording present");
  {
    const context: any = { productName: "Apex Titanium Flat Iron", targetMarket: "both", pricePoint: "$89.95" };
    const ourHeatTechLabel = "Titanium";

    const p1 = buildPhase1Prompt(context, FLAT_IRON_IDENTITY, TARGET_PRICE, TOOL_TYPES, ourHeatTechLabel, undefined, "heat_technology");
    const p2 = buildPhase2Prompt(context, FLAT_IRON_IDENTITY, TARGET_PRICE, TOOL_TYPES, undefined, ourHeatTechLabel, undefined, "heat_technology");

    for (const [label, { systemPrompt, userPrompt }] of [["Phase 1", p1], ["Phase 2", p2]] as const) {
      assert(!/motor/i.test(systemPrompt), `${label}'s systemPrompt contains zero "motor" substrings for a flat-iron (heat_technology-criterion) analysis`);
      assert(!/motor/i.test(userPrompt), `${label}'s userPrompt contains zero "motor" substrings for a flat-iron (heat_technology-criterion) analysis`);

      const priorityStart = systemPrompt.indexOf("DISCOVERY PRIORITY");
      const priorityEnd = systemPrompt.indexOf("CRITICAL RULES:");
      const discoveryPriorityParagraph = systemPrompt.slice(priorityStart, priorityEnd);
      assert(discoveryPriorityParagraph.includes("Titanium"), `${label}'s DISCOVERY PRIORITY paragraph names the resolved heat-tech label "Titanium"`);
      assert(discoveryPriorityParagraph.toLowerCase().includes("plate/heat technology"), `${label}'s DISCOVERY PRIORITY paragraph uses "plate/heat technology" wording, never "motor technology"`);

      const instructionsStart = userPrompt.indexOf("Instructions:");
      const instructionsText = userPrompt.slice(instructionsStart);
      assert(instructionsText.toLowerCase().includes("plate/heat technology"), `${label}'s Instructions combine plate/heat technology into the same example query as price`);
    }
  }

  console.log("\n[6] buildPhase1Prompt — a 'none'-criterion identity mentions neither \"motor\" nor \"plate/heat\"");
  {
    const context: any = { productName: "Apex Detangling Comb", targetMarket: "both", pricePoint: "$12.95" };
    const p1 = buildPhase1Prompt(context, OTHER_STYLING_IDENTITY, OTHER_STYLING_IDENTITY.priceObserved.value, TOOL_TYPES, null, undefined, "none");
    assert(!/motor/i.test(p1.systemPrompt) && !/motor/i.test(p1.userPrompt), "'none'-criterion prompt contains zero \"motor\" substrings");
    assert(!/plate\/heat/i.test(p1.systemPrompt) && !/plate\/heat/i.test(p1.userPrompt), "'none'-criterion prompt contains zero \"plate/heat\" substrings either — neither criterion ever applies");
  }

  console.log("\n[7] lib/heat-tech-taxonomy.ts / lib/heat-tech-extraction.ts — cascades in isolation");
  {
    assert(computeHeatTechMatchTier("titanium", "titanium") === "exact", "same family resolves 'exact'");
    assert(computeHeatTechMatchTier("titanium", "ceramic") === "different", "different families resolve 'different'");
    assert(computeHeatTechMatchTier(null, "ceramic") === "unverified", "either side null resolves 'unverified', never a false 'different'");
    assert(computeHeatTechMatchTier(null, null) === "unverified", "both sides null resolves 'unverified'");

    const normalized = normalizeHeatTech("Premium titanium-coated plates", HEAT_TECH_FAMILIES);
    assert(normalized.family?.familyKey === "titanium", `normalizeHeatTech resolves "titanium-coated" text to the titanium family (got ${normalized.family?.familyKey})`);

    // Cascade priority: spec table beats title beats bullets beats description.
    const specWins = extractCompetitorHeatTech({
      title: "Some Ceramic-Sounding Title",
      specifications: [{ name: "Plate Material", value: "Titanium" }],
      feature_bullets: ["Ceramic-adjacent marketing copy"],
      description: "Tourmaline mentioned here too",
    }, HEAT_TECH_FAMILIES);
    assert(specWins?.familyKey === "titanium" && specWins?.confirmedVia === "spec_table", `an explicit spec-table row wins over title/bullets/description (got ${specWins?.familyKey} via ${specWins?.confirmedVia})`);

    const bulletsOnly = extractCompetitorHeatTech({
      title: "Apex Pro Iron", feature_bullets: ["Genuine ionic technology for shine"], description: "",
    }, HEAT_TECH_FAMILIES);
    assert(bulletsOnly?.familyKey === "ionic" && bulletsOnly?.confirmedVia === "bullets", `falls back to feature bullets when no spec/title match exists (got ${bulletsOnly?.familyKey} via ${bulletsOnly?.confirmedVia})`);

    const noMatch = extractCompetitorHeatTech({ title: "Apex Pro Iron", feature_bullets: [], description: "" }, HEAT_TECH_FAMILIES);
    assert(noMatch === null, "returns null (never a guess) when nothing in the listing text matches any known family");

    const resolvedFromField = await resolveOurHeatTech({ heatTechFamily: "ceramic", projectId: null }, { whatItIs: "", keyAttributes: [], evidence: [] } as any, HEAT_TECH_FAMILIES);
    assert(resolvedFromField?.familyKey === "ceramic" && resolvedFromField?.source === "heat_tech_family_field", `resolveOurHeatTech prioritizes the canonical form field first (got ${resolvedFromField?.familyKey} via ${resolvedFromField?.source})`);

    const resolvedFromRaw = await resolveOurHeatTech({ heatTechRaw: "tourmaline-coated plates", projectId: null }, { whatItIs: "", keyAttributes: [], evidence: [] } as any, HEAT_TECH_FAMILIES);
    assert(resolvedFromRaw?.familyKey === "tourmaline" && resolvedFromRaw?.source === "heat_tech_raw_field", `resolveOurHeatTech falls back to the legacy free-text field when no canonical field is set (got ${resolvedFromRaw?.familyKey} via ${resolvedFromRaw?.source})`);

    const resolvedFromIdentity = await resolveOurHeatTech({ projectId: null }, { whatItIs: "A titanium-plate flat iron", keyAttributes: [], evidence: [] } as any, HEAT_TECH_FAMILIES);
    assert(resolvedFromIdentity?.familyKey === "titanium" && resolvedFromIdentity?.source === "identity_text", `resolveOurHeatTech falls back to the Identity Card's own text as a last resort (got ${resolvedFromIdentity?.familyKey} via ${resolvedFromIdentity?.source})`);

    const resolvedNone = await resolveOurHeatTech({ projectId: null }, { whatItIs: "A generic styling accessory", keyAttributes: [], evidence: [] } as any, HEAT_TECH_FAMILIES);
    assert(resolvedNone === null, "resolveOurHeatTech returns null (never a guess) when nothing resolves from any source");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
