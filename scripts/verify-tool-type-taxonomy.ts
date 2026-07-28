// scripts/verify-tool-type-taxonomy.ts
// Offline regression check for lib/tool-type-taxonomy.ts's pure logic:
// resolveToolType/assertToolType/deriveToolTypeFromCatalogProduct. No live
// OpenAI/Gemini/Rainforest calls — no .env.local is loaded, pure
// synchronous functions only.
//
// Run with: npx tsx scripts/verify-tool-type-taxonomy.ts

import { resolveToolType, assertToolType, deriveToolTypeFromCatalogProduct } from "../lib/tool-type-taxonomy";

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

console.log("\n[1] resolveToolType — clean single-type matches");
assert(resolveToolType("Wahl Professional Cordless Detailer Trimmer")?.type === "trimmer", "plain trimmer title resolves to trimmer");
assert(resolveToolType("Andis Master Clipper")?.type === "clipper", "plain clipper title resolves to clipper");
assert(resolveToolType("BaByliss Foil Shaver Pro")?.type === "shaver", "foil shaver alias resolves to shaver");
assert(resolveToolType("Ionic Ceramic Blow Dryer 1875W")?.type === "dryer", "blow dryer alias resolves to dryer");
assert(resolveToolType("Titanium Flat Iron Straightener")?.type === "flat_iron", "straightener alias resolves to flat_iron");
assert(resolveToolType("Professional Curling Wand 1 inch")?.type === "curling_iron", "curling wand alias resolves to curling_iron");
assert(resolveToolType("Ceramic Hot Brush Styler")?.type === "hot_brush", "hot brush alias resolves to hot_brush");

console.log("\n[2] resolveToolType — plurals and word-boundary safety (the actual bug fix)");
assert(resolveToolType("Professional Hair Clippers")?.type === "clipper", "plural 'Clippers' still resolves to clipper");
assert(resolveToolType("Cordless Trimmers for Men")?.type === "trimmer", "plural 'Trimmers' still resolves to trimmer");
assert(resolveToolType("") === null, "empty text resolves to null");

console.log("\n[3] resolveToolType — the critical fix: ambiguous when multiple types are present");
{
  const r = resolveToolType("Hair Clippers & Trimmers");
  assert(r !== null && r.ambiguous === true, "'Hair Clippers & Trimmers' (no combo signal) is ambiguous, not silently 'clipper'");
  assert(r !== null && !!r.candidates && r.candidates.includes("clipper") && r.candidates.includes("trimmer"), "ambiguous result names both candidate types");
}
assert(resolveToolType("hair crimper") === null, "unrecognized vocabulary ('crimper') resolves to null, never a guess");

console.log("\n[4] resolveToolType — combo/multi-groomer detection");
assert(resolveToolType("Wahl Clipper & Trimmer Combo Kit")?.type === "combo", "explicit combo phrase resolves to combo");
assert(resolveToolType("All-in-One Grooming Kit 10-in-1")?.type === "combo", "'all-in-one' signal resolves to combo");
assert(resolveToolType("2-in-1 Trimmer Duo Set")?.type === "combo", "'2-in-1'/'duo' signals resolve to combo even with a single-type word present");

console.log("\n[5] assertToolType — the shared strict validator");
assert(assertToolType("Andis Master Clipper", "clipper").ok === true, "clipper candidate passes for a clipper-required slot");
assert(assertToolType("Andis Master Clipper", "trimmer").ok === false, "clipper candidate REJECTED for a trimmer-required slot");
assert(assertToolType("Andis Master Clipper", "trimmer").reason === "tool_type_mismatch", "rejection reason is tool_type_mismatch");
assert(assertToolType("Wahl Detailer Trimmer", "trimmer").ok === true, "trimmer candidate passes for a trimmer-required slot");
assert(assertToolType("Wahl Detailer Trimmer", "clipper").ok === false, "trimmer candidate REJECTED for a clipper-required slot (the reverse direction)");
assert(assertToolType("Wahl Cordless Senior", "trimmer").ok === true, "brand/model text with no type word at all is not rejected (nothing concrete to contradict)");
assert(assertToolType("Hair Clippers & Trimmers Buying Guide", "trimmer").ok === false, "ambiguous candidate text rejected for a single-type slot");
assert(assertToolType("Hair Clippers & Trimmers Buying Guide", "trimmer").reason === "ambiguous_source", "ambiguous rejection reason is ambiguous_source");

console.log("\n[6] assertToolType — combo exclusion rule (spec's core requirement)");
assert(assertToolType("Wahl Clipper & Trimmer Combo Kit", "trimmer").ok === false, "a combo/multi-groomer NEVER fills a single-type (trimmer) slot");
assert(assertToolType("Wahl Clipper & Trimmer Combo Kit", "clipper").ok === false, "a combo/multi-groomer NEVER fills a single-type (clipper) slot either");
assert(assertToolType("Wahl Clipper & Trimmer Combo Kit", "combo").ok === true, "a combo candidate is fine for a combo-required slot");
assert(assertToolType("Andis Master Clipper", "combo").ok === true, "a single-type candidate is permitted for a combo-required slot (permissive by design)");

console.log("\n[7] The spec's own worked example — 360 Jeezy Clipper vs 360 Jeezy Trimmer");
assert(assertToolType("360 Jeezy Clipper", "trimmer").ok === false, "the sibling clipper is REJECTED as a trimmer competitor");
assert(assertToolType("360 Jeezy Trimmer", "clipper").ok === false, "the sibling trimmer is REJECTED as a clipper competitor");
assert(assertToolType("360 Jeezy Trimmer", "trimmer").ok === true, "the correct-type sibling passes");

console.log("\n[8] deriveToolTypeFromCatalogProduct — StyleCraft catalog quick-fill mapping");
assert(deriveToolTypeFromCatalogProduct({ category: "Clippers", amazonCategory: "Professional Hair Clippers" }) === "clipper", "catalog Clippers -> clipper");
assert(deriveToolTypeFromCatalogProduct({ category: "Trimmers", amazonCategory: "Professional Hair Trimmers" }) === "trimmer", "catalog Trimmers -> trimmer");
assert(deriveToolTypeFromCatalogProduct({ category: "Shavers", amazonCategory: "Professional Foil Shavers" }) === "shaver", "specific amazonCategory ('Foil Shavers') resolves shaver even under a coarser bucket");
assert(deriveToolTypeFromCatalogProduct({ category: "Sets", amazonCategory: "Clipper & Trimmer Combo Set" }) === "combo", "catalog Sets -> combo");
assert(deriveToolTypeFromCatalogProduct({ category: "Apparel", amazonCategory: "T-Shirt" }) === null, "non-tool catalog categories (Apparel) resolve to null, not coerced into a tool type");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
