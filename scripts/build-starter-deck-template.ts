// scripts/build-starter-deck-template.ts
// Builds the 9-slide starter Project Deck template (Phase 1 of the
// splendid-hopping-starfish plan) — one slide per spec section, exercising
// every DeckTokenKind (text/image/table/date) plus the one guaranteed-
// unmapped token (launch_timing), so the whole pipeline is testable end to
// end before the real company template is uploaded.
//
// pptxgenjs is used ONLY as a one-off asset-building tool here (it builds
// decks from scratch, which is exactly wrong for the actual runtime
// renderer — see lib/deck-render.ts, which edits an existing template in
// place via docxtemplater instead). It is intentionally NOT a project
// dependency; install it locally before running this script:
//   npm install --no-save pptxgenjs
//
// Run with: npx tsx scripts/build-starter-deck-template.ts
// Output: scratch/starter-deck-template.pptx (upload this through the
// Deck Templates admin page once Phase 1 ships).

import path from "path";

async function main() {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "STYLECRAFT_16x9", width: 10, height: 5.625 });
  pres.layout = "STYLECRAFT_16x9";

  const TITLE_OPTS = { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: "1F1F1F" };
  const BODY_OPTS = { x: 0.5, y: 1.1, w: 9, h: 4, fontSize: 14, color: "333333" };

  // 1. Title
  {
    const slide = pres.addSlide();
    slide.addText("{{product_title}}", { x: 0.5, y: 1.6, w: 9, h: 1, fontSize: 32, bold: true, align: "center" });
    slide.addText("{{product_image}}", { x: 3, y: 2.8, w: 4, h: 2, fontSize: 12, align: "center", fill: { color: "EEEEEE" }, line: { color: "CCCCCC" } });
    slide.addText("{{project_name}}", { x: 0.5, y: 5.0, w: 4, h: 0.4, fontSize: 10 });
    slide.addText("{{generated_date}}", { x: 5.5, y: 5.0, w: 4, h: 0.4, fontSize: 10, align: "right" });
  }

  // 2. Product Overview
  {
    const slide = pres.addSlide();
    slide.addText("Product Overview", TITLE_OPTS);
    slide.addText("{{positioning_statement}}", { ...BODY_OPTS, h: 2 });
    slide.addText("{{product_name_origin}}", { ...BODY_OPTS, y: 3.2, h: 1.5 });
  }

  // 3. Why We're Creating It
  {
    const slide = pres.addSlide();
    slide.addText("Why We're Creating It", TITLE_OPTS);
    slide.addText("{{why_creating_item}}", BODY_OPTS);
  }

  // 4. Key Features & Specs
  {
    const slide = pres.addSlide();
    slide.addText("Key Features & Specs", TITLE_OPTS);
    slide.addText("{{feature_list}}", { ...BODY_OPTS, h: 2 });
    slide.addText("{{spec_highlights}}", { ...BODY_OPTS, y: 3.2, h: 1.5 });
  }

  // 5. USPs / Reason to Buy
  {
    const slide = pres.addSlide();
    slide.addText("Reason to Buy", TITLE_OPTS);
    slide.addText("{{usp_1}}", { x: 0.5, y: 1.1, w: 9, h: 0.7, fontSize: 13 });
    slide.addText("{{usp_2}}", { x: 0.5, y: 1.8, w: 9, h: 0.7, fontSize: 13 });
    slide.addText("{{usp_3}}", { x: 0.5, y: 2.5, w: 9, h: 0.7, fontSize: 13 });
    slide.addText("{{usp_4}}", { x: 0.5, y: 3.2, w: 9, h: 0.7, fontSize: 13 });
    slide.addText("{{usp_5}}", { x: 0.5, y: 3.9, w: 9, h: 0.7, fontSize: 13 });
  }

  // 6. Competitive Landscape (table/loop token)
  {
    const slide = pres.addSlide();
    slide.addText("Competitive Landscape", TITLE_OPTS);
    slide.addText("{{#competitor_table}}{{name}} - {{brand}} - {{tier}} - {{price}}{{/competitor_table}}", { ...BODY_OPTS, h: 2.5 });
    slide.addText("{{price_positioning}}", { ...BODY_OPTS, y: 3.8, h: 1 });
  }

  // 7. Pricing
  {
    const slide = pres.addSlide();
    slide.addText("Pricing", TITLE_OPTS);
    slide.addText("{{price}}", { x: 0.5, y: 1.2, w: 4, h: 0.6, fontSize: 20, bold: true });
    slide.addText("{{good_better_best}}", { x: 5, y: 1.2, w: 4, h: 0.6, fontSize: 16 });
    slide.addText("{{price_positioning}}", { ...BODY_OPTS, y: 2.2, h: 2 });
  }

  // 8. Go-to-Market
  {
    const slide = pres.addSlide();
    slide.addText("Go-to-Market", TITLE_OPTS);
    slide.addText("{{core_audience}}", { ...BODY_OPTS, h: 1.2 });
    slide.addText("{{launch_timing}}", { ...BODY_OPTS, y: 2.5, h: 1 }); // deliberately unmapped — see Context
    slide.addText("{{channel_highlights}}", { ...BODY_OPTS, y: 3.7, h: 1 });
  }

  // 9. Appendix
  {
    const slide = pres.addSlide();
    slide.addText("Appendix — Data Sources", TITLE_OPTS);
    slide.addText("{{data_sources}}", BODY_OPTS);
  }

  const outDir = path.resolve(process.cwd(), "scratch");
  const fs = await import("fs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "starter-deck-template.pptx");
  await pres.writeFile({ fileName: outPath });
  console.log(`Wrote ${outPath}`);
}

main().catch(err => {
  console.error("Failed to build starter template:", err);
  process.exit(1);
});
