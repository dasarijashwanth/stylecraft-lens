// scripts/verify-content-form-field-schema.ts
// Offline regression check for lib/content-form-field-schema.ts — the
// Content Form tab's 15-logical-item field inventory (12 singular fields +
// 5 repeatable-row groups = 33 total document_fields rows). Pure data
// checks, zero I/O.
//
// Run with: npx tsx scripts/verify-content-form-field-schema.ts

export {};

let passes = 0;
let failures = 0;

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
  const { CONTENT_FORM_SCHEMA, CONTENT_FORM_SECTIONS } = await import("../lib/content-form-field-schema");

  console.log("\n[1] Total row count and no duplicate ids");
  assert(CONTENT_FORM_SCHEMA.length === 33, `33 total document_fields rows (12 singular + 3+6+6+3+3 group rows), got ${CONTENT_FORM_SCHEMA.length}`);
  const ids = CONTENT_FORM_SCHEMA.map(f => f.id);
  assert(new Set(ids).size === ids.length, "no duplicate field ids across the whole schema");

  console.log("\n[2] All 12 singular fields present");
  const singularIds = [
    "amazon_long_title", "ecommerce_title", "website_title", "sexy_tagline", "techie_tagline",
    "short_description", "features_benefits", "suggested_use", "romance_copy",
    "ad_sheet_headline", "ad_sheet_sub_header", "keywords",
  ];
  for (const id of singularIds) {
    assert(ids.includes(id), `singular field "${id}" exists`);
  }

  console.log("\n[3] All 5 repeatable-row groups have the correct total");
  const groupExpectations: { prefix: string; total: number }[] = [
    { prefix: "bullet_top3", total: 3 },
    { prefix: "bullet_long", total: 6 },
    { prefix: "bullet_condensed", total: 6 },
    { prefix: "website_copy_short", total: 3 },
    { prefix: "website_copy_long", total: 3 },
  ];
  for (const { prefix, total } of groupExpectations) {
    const rows = CONTENT_FORM_SCHEMA.filter(f => f.group?.id === prefix);
    assert(rows.length === total, `group "${prefix}" has exactly ${total} rows (got ${rows.length})`);
    assert(rows.every((r, i) => r.group!.index === i + 1 && r.group!.total === total), `group "${prefix}" rows have correct sequential index/total metadata`);
    for (let i = 1; i <= total; i++) {
      assert(ids.includes(`${prefix}_${i}`), `group "${prefix}" row #${i} has the expected field id "${prefix}_${i}"`);
    }
  }

  console.log("\n[4] Character limits on exactly the 4 fields that need one");
  const charLimited = CONTENT_FORM_SCHEMA.filter(f => f.charLimit != null);
  assert(charLimited.length === 4, `exactly 4 fields carry a charLimit (got ${charLimited.length})`);
  assert(CONTENT_FORM_SCHEMA.find(f => f.id === "short_description")?.charLimit === 229, "Short Description charLimit is 229");
  assert(CONTENT_FORM_SCHEMA.find(f => f.id === "features_benefits")?.charLimit === 115, "Features & Benefits charLimit is 115");
  assert(CONTENT_FORM_SCHEMA.find(f => f.id === "suggested_use")?.charLimit === 200, "Suggested Use charLimit is 200");
  assert(CONTENT_FORM_SCHEMA.find(f => f.id === "romance_copy")?.charLimit === 2000, "Romance Copy charLimit is 2000 (the real template's own cap, adopted alongside the spec's other 3 limits)");
  assert(!CONTENT_FORM_SCHEMA.some(f => !["short_description", "features_benefits", "suggested_use", "romance_copy"].includes(f.id) && f.charLimit != null), "no OTHER field was accidentally given a charLimit");

  console.log("\n[5] Every field is kind='written' with a default owner");
  assert(CONTENT_FORM_SCHEMA.every(f => f.kind === "written"), "every Content Form field is AI-generated ('written'), none are internal-decision fields");
  assert(CONTENT_FORM_SCHEMA.every(f => f.owner === "Product Marketing"), "every field defaults to the same owner the rest of this app's report-driven tabs already use");

  console.log("\n[6] Sections derive correctly and in first-appearance order");
  assert(CONTENT_FORM_SECTIONS[0] === "Titles" && CONTENT_FORM_SECTIONS.includes("Keywords"), `sections start with "Titles" and include "Keywords" (got ${JSON.stringify(CONTENT_FORM_SECTIONS)})`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
