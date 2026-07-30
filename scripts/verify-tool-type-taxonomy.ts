// scripts/verify-tool-type-taxonomy.ts
// Offline regression check for lib/tool-type-taxonomy.ts's pure logic:
// resolveToolType/assertToolType/deriveToolTypeFromCatalogProduct. No live
// OpenAI/Gemini/Rainforest calls — no .env.local is loaded, pure
// synchronous functions only.
//
// Run with: npx tsx scripts/verify-tool-type-taxonomy.ts

import { resolveToolType, assertToolType, deriveToolTypeFromCatalogProduct } from "../lib/tool-type-taxonomy";
import type { ToolTypeRow } from "../lib/db/tool-types";

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

// Mirrors lib/memoryDb.ts's seedToolTypeDefaults exactly (the real
// production seed) — one shared fixture reused in every assertion below so
// this stays a faithful regression check of real alias behavior, not just
// this script's own invented vocabulary.
function makeToolTypesFixture(): ToolTypeRow[] {
  const now = new Date().toISOString();
  const defs: { key: string; label: string; aliases: string[]; family: string | null }[] = [
    { key: "trimmer", label: "Trimmer", aliases: ["trimmer", "beard trimmer", "detailer", "outliner", "liner", "edger"], family: "clipper_trimmer_shaver" },
    { key: "shaver", label: "Shaver", aliases: ["shaver", "foil shaver", "rotary shaver", "electric shaver", "razor"], family: "clipper_trimmer_shaver" },
    { key: "dryer", label: "Hair Dryer", aliases: ["dryer", "blow dryer", "diffuser"], family: "beauty" },
    { key: "flat_iron", label: "Flat Iron", aliases: ["flat iron", "straightener", "hair iron"], family: "beauty" },
    { key: "curling_iron", label: "Curling Iron", aliases: ["curling iron", "curling wand", "curler", "wand"], family: "beauty" },
    { key: "hot_brush", label: "Hot Brush", aliases: ["hot brush", "styling brush", "heated brush"], family: "beauty" },
    { key: "clipper", label: "Clipper", aliases: ["clipper"], family: "clipper_trimmer_shaver" },
    { key: "other_styling", label: "Other Styling Tool", aliases: [], family: "beauty" },
    { key: "combo", label: "Combo / Multi-Tool Kit", aliases: [], family: null },
  ];
  return defs.map((d, i) => ({
    id: `ttype_${d.key}`,
    type_key: d.key,
    label: d.label,
    aliases: d.aliases,
    family: d.family,
    enabled: true,
    custom: false,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }));
}

const TOOL_TYPES = makeToolTypesFixture();

console.log("\n[1] resolveToolType — clean single-type matches");
assert(resolveToolType("Wahl Professional Cordless Detailer Trimmer", TOOL_TYPES)?.type === "trimmer", "plain trimmer title resolves to trimmer");
assert(resolveToolType("Andis Master Clipper", TOOL_TYPES)?.type === "clipper", "plain clipper title resolves to clipper");
assert(resolveToolType("BaByliss Foil Shaver Pro", TOOL_TYPES)?.type === "shaver", "foil shaver alias resolves to shaver");
assert(resolveToolType("Ionic Ceramic Blow Dryer 1875W", TOOL_TYPES)?.type === "dryer", "blow dryer alias resolves to dryer");
assert(resolveToolType("Titanium Flat Iron Straightener", TOOL_TYPES)?.type === "flat_iron", "straightener alias resolves to flat_iron");
assert(resolveToolType("Professional Curling Wand 1 inch", TOOL_TYPES)?.type === "curling_iron", "curling wand alias resolves to curling_iron");
assert(resolveToolType("Ceramic Hot Brush Styler", TOOL_TYPES)?.type === "hot_brush", "hot brush alias resolves to hot_brush");

console.log("\n[2] resolveToolType — plurals and word-boundary safety (the actual bug fix)");
assert(resolveToolType("Professional Hair Clippers", TOOL_TYPES)?.type === "clipper", "plural 'Clippers' still resolves to clipper");
assert(resolveToolType("Cordless Trimmers for Men", TOOL_TYPES)?.type === "trimmer", "plural 'Trimmers' still resolves to trimmer");
assert(resolveToolType("", TOOL_TYPES) === null, "empty text resolves to null");

console.log("\n[3] resolveToolType — the critical fix: ambiguous when multiple types are present");
{
  const r = resolveToolType("Hair Clippers & Trimmers", TOOL_TYPES);
  assert(r !== null && r.ambiguous === true, "'Hair Clippers & Trimmers' (no combo signal) is ambiguous, not silently 'clipper'");
  assert(r !== null && !!r.candidates && r.candidates.includes("clipper") && r.candidates.includes("trimmer"), "ambiguous result names both candidate types");
}
assert(resolveToolType("hair crimper", TOOL_TYPES) === null, "unrecognized vocabulary ('crimper') resolves to null, never a guess");

console.log("\n[4] resolveToolType — combo/multi-groomer detection");
assert(resolveToolType("Wahl Clipper & Trimmer Combo Kit", TOOL_TYPES)?.type === "combo", "explicit combo phrase resolves to combo");
assert(resolveToolType("All-in-One Grooming Kit 10-in-1", TOOL_TYPES)?.type === "combo", "'all-in-one' signal resolves to combo");
assert(resolveToolType("2-in-1 Trimmer Duo Set", TOOL_TYPES)?.type === "combo", "'2-in-1'/'duo' signals resolve to combo even with a single-type word present");

console.log("\n[5] assertToolType — the shared strict validator");
assert(assertToolType("Andis Master Clipper", "clipper", TOOL_TYPES).ok === true, "clipper candidate passes for a clipper-required slot");
assert(assertToolType("Andis Master Clipper", "trimmer", TOOL_TYPES).ok === false, "clipper candidate REJECTED for a trimmer-required slot");
assert(assertToolType("Andis Master Clipper", "trimmer", TOOL_TYPES).reason === "tool_type_mismatch", "rejection reason is tool_type_mismatch");
assert(assertToolType("Wahl Detailer Trimmer", "trimmer", TOOL_TYPES).ok === true, "trimmer candidate passes for a trimmer-required slot");
assert(assertToolType("Wahl Detailer Trimmer", "clipper", TOOL_TYPES).ok === false, "trimmer candidate REJECTED for a clipper-required slot (the reverse direction)");
assert(assertToolType("Wahl Cordless Senior", "trimmer", TOOL_TYPES).ok === true, "brand/model text with no type word at all is not rejected (nothing concrete to contradict)");
assert(assertToolType("Hair Clippers & Trimmers Buying Guide", "trimmer", TOOL_TYPES).ok === false, "ambiguous candidate text rejected for a single-type slot");
assert(assertToolType("Hair Clippers & Trimmers Buying Guide", "trimmer", TOOL_TYPES).reason === "ambiguous_source", "ambiguous rejection reason is ambiguous_source");

console.log("\n[6] assertToolType — combo exclusion rule (spec's core requirement)");
assert(assertToolType("Wahl Clipper & Trimmer Combo Kit", "trimmer", TOOL_TYPES).ok === false, "a combo/multi-groomer NEVER fills a single-type (trimmer) slot");
assert(assertToolType("Wahl Clipper & Trimmer Combo Kit", "clipper", TOOL_TYPES).ok === false, "a combo/multi-groomer NEVER fills a single-type (clipper) slot either");
assert(assertToolType("Wahl Clipper & Trimmer Combo Kit", "combo", TOOL_TYPES).ok === true, "a combo candidate is fine for a combo-required slot");
assert(assertToolType("Andis Master Clipper", "combo", TOOL_TYPES).ok === true, "a single-type candidate is permitted for a combo-required slot (permissive by design)");

console.log("\n[7] The spec's own worked example — 360 Jeezy Clipper vs 360 Jeezy Trimmer");
assert(assertToolType("360 Jeezy Clipper", "trimmer", TOOL_TYPES).ok === false, "the sibling clipper is REJECTED as a trimmer competitor");
assert(assertToolType("360 Jeezy Trimmer", "clipper", TOOL_TYPES).ok === false, "the sibling trimmer is REJECTED as a clipper competitor");
assert(assertToolType("360 Jeezy Trimmer", "trimmer", TOOL_TYPES).ok === true, "the correct-type sibling passes");

console.log("\n[8] deriveToolTypeFromCatalogProduct — StyleCraft catalog quick-fill mapping");
assert(deriveToolTypeFromCatalogProduct({ category: "Clippers", amazonCategory: "Professional Hair Clippers" }, TOOL_TYPES) === "clipper", "catalog Clippers -> clipper");
assert(deriveToolTypeFromCatalogProduct({ category: "Trimmers", amazonCategory: "Professional Hair Trimmers" }, TOOL_TYPES) === "trimmer", "catalog Trimmers -> trimmer");
assert(deriveToolTypeFromCatalogProduct({ category: "Shavers", amazonCategory: "Professional Foil Shavers" }, TOOL_TYPES) === "shaver", "specific amazonCategory ('Foil Shavers') resolves shaver even under a coarser bucket");
assert(deriveToolTypeFromCatalogProduct({ category: "Sets", amazonCategory: "Clipper & Trimmer Combo Set" }, TOOL_TYPES) === "combo", "catalog Sets -> combo");
assert(deriveToolTypeFromCatalogProduct({ category: "Apparel", amazonCategory: "T-Shirt" }, TOOL_TYPES) === null, "non-tool catalog categories (Apparel) resolve to null, not coerced into a tool type");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
