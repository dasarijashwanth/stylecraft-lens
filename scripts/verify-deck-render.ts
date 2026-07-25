// scripts/verify-deck-render.ts
// Validates lib/deck-condense.ts + lib/deck-render.ts against the real
// starter template built by scripts/build-starter-deck-template.ts, using
// synthetic (non-AI) data end to end. No live OpenAI/Gemini/Rainforest
// calls — the condense-to-fit path is exercised via a forced "already over
// budget" clock so it takes the exact same deterministic-fallback branch
// production would take on a timeout, without ever calling the API.
//
// Run with: npx tsx scripts/verify-deck-render.ts
// (build the fixture first: npx tsx scripts/build-starter-deck-template.ts)

import { readFileSync } from "fs";
import path from "path";
import PizZip from "pizzip";

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
  const { truncateDeterministic, condenseDeckText, DECK_CONDENSE_TIME_BUDGET_MS } = await import("../lib/deck-condense");
  const { parseDeckTemplate } = await import("../lib/deck-template-parser");
  const { buildDefaultPlaceholderMap } = await import("../lib/deck-field-registry");
  const { renderDeck } = await import("../lib/deck-render");

  console.log("\n[1] truncateDeterministic — word-boundary + never-mid-number");
  assert(truncateDeterministic("short", 20) === "short", "text under the limit is returned unchanged");
  const wordCut = truncateDeterministic("The quick brown fox jumps over the lazy dog", 19);
  assert(wordCut.length <= 20, `cut text (+ellipsis) stays near the budget (got "${wordCut}", length ${wordCut.length})`);
  assert(!wordCut.includes("jum"), `never cuts mid-word (got "${wordCut}")`);
  const priceText = "Priced at $149.99, well below the $199.99 category average";
  const priceCut = truncateDeterministic(priceText, 14);
  assert(!/\$1\d\d\.\d$/.test(priceCut.replace("…", "")), `never cuts mid-number (got "${priceCut}")`);

  console.log("\n[2] condenseDeckText — forced-over-budget path never calls the live API");
  const longText = "This clipper delivers seven thousand five hundred RPM with a three hour cordless runtime, beating every competitor in its class on both power and endurance.";
  const overBudgetStart = Date.now() - DECK_CONDENSE_TIME_BUDGET_MS - 5_000; // already expired
  const condensed = await condenseDeckText(
    { positioning_statement: longText, short_field: "already short" },
    { positioning_statement: 40, short_field: 40 },
    overBudgetStart
  );
  assert(condensed.positioning_statement.length <= 41, `over-length field was condensed to fit (got ${condensed.positioning_statement.length} chars: "${condensed.positioning_statement}")`);
  assert(condensed.short_field === "already short", "field already under budget is left untouched");

  console.log("\n[3] renderDeck — fill-or-hide + text/table substitution against the real starter template");
  const fixturePath = path.resolve(process.cwd(), "scratch", "starter-deck-template.pptx");
  const templateBuffer = readFileSync(fixturePath);
  const parsed = await parseDeckTemplate(templateBuffer);
  const placeholderMap = buildDefaultPlaceholderMap(parsed);

  const PRODUCT_TITLE = "Rival Clipper Pro";
  const values: Record<string, any> = {
    product_title: PRODUCT_TITLE,
    product_image: { sourceUrl: "https://example.com/hero.jpg", targetWidthPx: 400, targetHeightPx: 300 },
    project_name: PRODUCT_TITLE,
    generated_date: "July 25, 2026",
    positioning_statement: "The fastest cordless clipper built for professional fade work.",
    product_name_origin: "Named for its head-to-head performance against category rivals.",
    why_creating_item: "", // deliberately empty — the ONLY token on slide 3, so slide 3 must be removed
    feature_list: "7,500 RPM motor; 3-hour runtime; stainless steel blade; 6 premium guards",
    spec_highlights: "Motor: Pro-series · RPM: 7,500 · Run-time: 3 hours",
    usp_1: "Cuts through thick hair without stalling",
    usp_2: "3-hour cordless runtime beats every competitor",
    usp_3: "Ceramic blade stays cooler for longer sessions",
    usp_4: "Ergonomic grip reduces wrist fatigue",
    usp_5: "Charges fully in under 3 hours",
    competitor_table: [
      { name: "Rival Clipper", brand: "StyleCraft", tier: "Large Brand", price: "$79.95" },
      { name: "Cyclone Clipper", brand: "UNKWN", tier: "Indie/Emerging", price: "$129.99" },
    ],
    price_positioning: "Priced below the category average while matching premium runtime specs.",
    price: "$79.95",
    good_better_best: "Better tier — between the entry Fade Pro and flagship Cordless Elite.",
    core_audience: "Licensed barbers doing 30+ fades a week.",
    launch_timing: "", // deliberately unmapped — always blank, see lib/deck-field-registry.ts
    channel_highlights: "Lead with in-salon demo kits; pair with influencer seeding pre-launch.",
    data_sources: "12/15 GTM fields verified · primarily from web · 8 competitors benchmarked",
  };
  for (const t of placeholderMap.tokens) {
    if (!(t.token in values)) values[t.token] = t.kind === "table" ? [] : t.kind === "image" ? { sourceUrl: null, targetWidthPx: 100, targetHeightPx: 100 } : "";
  }

  const { buffer, slidesRemoved } = await renderDeck(templateBuffer, placeholderMap, values);

  assert(slidesRemoved.length === 1 && slidesRemoved[0] === 3, `exactly slide 3 ("Why We're Creating It") was flagged for removal (got [${slidesRemoved.join(", ")}])`);

  const outputZip = new PizZip(buffer);
  assert(!!outputZip.file("ppt/presentation.xml"), "output is a valid, re-openable zip archive");

  const reparsed = await parseDeckTemplate(buffer);
  assert(reparsed.slideCount === 8, `output deck has 8 slides after removal (got ${reparsed.slideCount})`);

  const slideFiles = outputZip.file(/^ppt\/slides\/slide\d+\.xml$/);
  assert(slideFiles.length === 8, `exactly 8 slideN.xml parts remain in the zip (got ${slideFiles.length})`);

  const allSlideText = slideFiles.map(f => f.asText()).join("\n");
  assert(!allSlideText.includes("Why We're Creating It"), "removed slide's static heading text no longer appears anywhere in the output");
  assert(allSlideText.includes(PRODUCT_TITLE), `substituted product_title value appears in the output ("${PRODUCT_TITLE}")`);
  assert(allSlideText.includes("Rival Clipper") && allSlideText.includes("$79.95") && allSlideText.includes("Cyclone Clipper"), "competitor_table loop rendered both rows with their real values");
  assert(!allSlideText.includes("{{"), "no unsubstituted {{token}} markers remain anywhere in the output");

  const contentTypesXml = outputZip.file("[Content_Types].xml")?.asText() || "";
  const contentTypesSlideOverrides = (contentTypesXml.match(/<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"/g) || []).length;
  assert(contentTypesSlideOverrides === 8, `[Content_Types].xml lists exactly 8 slide overrides after removal (got ${contentTypesSlideOverrides})`);

  const presRels = outputZip.file("ppt/_rels/presentation.xml.rels")?.asText() || "";
  const presentationXml = outputZip.file("ppt/presentation.xml")?.asText() || "";
  const sldIdCount = (presentationXml.match(/<p:sldId /g) || []).length;
  assert(sldIdCount === 8, `presentation.xml's <p:sldIdLst> lists exactly 8 slides (got ${sldIdCount})`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
