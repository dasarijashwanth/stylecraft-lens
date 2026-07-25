// scripts/verify-deck-template-parser.ts
// Validates lib/deck-template-parser.ts + lib/deck-field-registry.ts's
// buildDefaultPlaceholderMap() against the real starter template built by
// scripts/build-starter-deck-template.ts. No live network/AI calls — pure
// local file parsing.
//
// Run with: npx tsx scripts/verify-deck-template-parser.ts
// (build the fixture first: npx tsx scripts/build-starter-deck-template.ts)

import { readFileSync } from "fs";
import path from "path";

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

async function main() {
  const { parseDeckTemplate } = await import("../lib/deck-template-parser");
  const { buildDefaultPlaceholderMap, DECK_TOKEN_REGISTRY } = await import("../lib/deck-field-registry");

  const fixturePath = path.resolve(process.cwd(), "scratch", "starter-deck-template.pptx");
  const buffer = readFileSync(fixturePath);

  console.log("\n[1] parseDeckTemplate — token discovery against the real starter template");
  const parsed = await parseDeckTemplate(buffer);

  assert(parsed.slideCount === 9, `slide count is 9 (got ${parsed.slideCount})`);

  const tokenNames = parsed.tokens.map(t => t.token).sort();
  const expectedTokens = [
    "product_title", "product_image", "project_name", "generated_date",
    "positioning_statement", "product_name_origin", "why_creating_item",
    "feature_list", "spec_highlights",
    "usp_1", "usp_2", "usp_3", "usp_4", "usp_5",
    "competitor_table", "price_positioning",
    "price", "good_better_best",
    "core_audience", "launch_timing", "channel_highlights",
    "data_sources",
  ].sort();
  for (const expected of expectedTokens) {
    assert(tokenNames.includes(expected), `discovered token "${expected}"`);
  }
  assert(tokenNames.length === expectedTokens.length, `no unexpected extra tokens discovered (got ${tokenNames.length}, expected ${expectedTokens.length}: ${tokenNames.join(", ")})`);

  // The loop body's inner fields (name/brand/tier/price) must NOT be
  // registered as separate top-level tokens.
  assert(!tokenNames.includes("name"), "loop-inner field {{name}} is not registered as a top-level token");
  assert(!tokenNames.includes("brand"), "loop-inner field {{brand}} is not registered as a top-level token");
  assert(!tokenNames.includes("tier"), "loop-inner field {{tier}} is not registered as a top-level token");

  const competitorTableToken = parsed.tokens.find(t => t.token === "competitor_table");
  assert(!!competitorTableToken, "competitor_table token was discovered");
  assert(competitorTableToken!.occurrences.length === 1, "competitor_table occurs exactly once");
  assert(competitorTableToken!.occurrences[0].slide_index === 6, `competitor_table is on slide 6 (got ${competitorTableToken!.occurrences[0].slide_index})`);

  const productTitleToken = parsed.tokens.find(t => t.token === "product_title");
  assert(productTitleToken!.occurrences[0].slide_index === 1, "product_title is on slide 1 (presentation order)");

  const usp1Token = parsed.tokens.find(t => t.token === "usp_1");
  assert(usp1Token!.occurrences[0].slide_index === 5, "usp_1 is on slide 5");

  const productImageToken = parsed.tokens.find(t => t.token === "product_image");
  assert(!!productImageToken?.imageBoxPx, "product_image captured real shape geometry (image_box_px)");
  if (productImageToken?.imageBoxPx) {
    assert(productImageToken.imageBoxPx.width > 0 && productImageToken.imageBoxPx.height > 0, `image_box_px has positive dimensions (${productImageToken.imageBoxPx.width}x${productImageToken.imageBoxPx.height})`);
  }

  console.log("\n[2] buildDefaultPlaceholderMap — registry resolution + unmapped detection");
  const map = buildDefaultPlaceholderMap(parsed);

  assert(map.slide_count === 9, "placeholder map slide_count matches parsed slideCount");
  assert(map.tokens.length === parsed.tokens.length, "placeholder map has one entry per discovered token");

  const productImageMapped = map.tokens.find(t => t.token === "product_image");
  assert(productImageMapped?.kind === "image", `product_image resolves to kind "image" via the registry (got "${productImageMapped?.kind}")`);
  assert(productImageMapped?.source.type === "snapshot_image", "product_image resolves to a snapshot_image source");

  const competitorTableMapped = map.tokens.find(t => t.token === "competitor_table");
  assert(competitorTableMapped?.kind === "table", `competitor_table resolves to kind "table" (got "${competitorTableMapped?.kind}")`);

  const usp1Mapped = map.tokens.find(t => t.token === "usp_1");
  assert(usp1Mapped?.source.type === "gtm_field" && (usp1Mapped.source as any).field_id === "reason_to_buy" && (usp1Mapped.source as any).split_index === 0,
    "usp_1 resolves to gtm_field reason_to_buy, split_index 0");

  assert(map.unmapped_tokens.includes("launch_timing"), "launch_timing is flagged as unmapped (the known data gap)");
  assert(map.unmapped_tokens.length === 1, `exactly 1 unmapped token (got ${map.unmapped_tokens.length}: ${map.unmapped_tokens.join(", ")})`);

  console.log("\n[3] splitNumberedList — never invents or drops content");
  const { splitNumberedList } = await import("../lib/deck-field-registry");
  const numbered = splitNumberedList("1. First claim about the product.\n2. Second claim.\n3. Third claim.", 5);
  assert(numbered.length === 3, `numbered list splits into 3 parts (got ${numbered.length})`);
  assert(numbered[0] === "First claim about the product.", `first part is correct (got "${numbered[0]}")`);

  const unsplittable = splitNumberedList("A single paragraph with no numbering at all.", 5);
  assert(unsplittable.length === 1 && unsplittable[0] === "A single paragraph with no numbering at all.", "text with no numbered pattern returns as a single whole element, never dropped");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
