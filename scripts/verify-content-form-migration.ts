// scripts/verify-content-form-migration.ts
// Offline unit test for lib/content-form-migration.ts's pure planning
// function — no Supabase/OpenAI/Gemini call of any kind (planContentFormMigration
// is pure string logic over a plain object).
//
// Run with: npx tsx scripts/verify-content-form-migration.ts

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
  const { planContentFormMigration } = await import("../lib/content-form-migration");
  const { CONTENT_FORM_SCHEMA } = await import("../lib/content-form-field-schema");

  console.log("\n[1] Full old blob — all 3 notes stashes produced, all 33 placeholders listed");
  const fullPlan = planContentFormMigration({
    product_name: "Anime Trimmer",
    key_messages: ["Zero-gap precision.", "Ultra-quiet operation.", ""],
    target_audience: "Barbers and stylists who want precision lining.",
    notes: "Competitor gap: no quiet option under $100.",
  });
  assert(fullPlan.placeholderFieldIds.length === CONTENT_FORM_SCHEMA.length, `placeholderFieldIds lists all ${CONTENT_FORM_SCHEMA.length} schema fields (got ${fullPlan.placeholderFieldIds.length})`);
  assert(new Set(fullPlan.placeholderFieldIds).size === fullPlan.placeholderFieldIds.length, "placeholderFieldIds has no duplicates");
  assert(fullPlan.notesStashes.length === 3, `exactly 3 notes stashes produced (got ${fullPlan.notesStashes.length})`);

  const romanceStash = fullPlan.notesStashes.find(s => s.fieldId === "romance_copy");
  assert(!!romanceStash && romanceStash.notesText.includes("Anime Trimmer") && romanceStash.notesText.includes("Zero-gap precision.") && romanceStash.notesText.includes("Ultra-quiet operation."), "romance_copy's Notes includes product_name and every non-empty key_message");
  assert(!!romanceStash && !romanceStash.notesText.includes("| |"), "romance_copy's Notes never joins an empty key_message as a bare separator");

  const suggestedUseStash = fullPlan.notesStashes.find(s => s.fieldId === "suggested_use");
  assert(!!suggestedUseStash && suggestedUseStash.notesText.includes("Barbers and stylists"), "suggested_use's Notes includes the old target_audience text");

  const keywordsStash = fullPlan.notesStashes.find(s => s.fieldId === "keywords");
  assert(!!keywordsStash && keywordsStash.notesText.includes("Competitor gap"), "keywords's Notes includes the old free-text notes");

  console.log("\n[2] Null/empty old blob — zero notes stashes, but placeholders are still planned for every field");
  const emptyPlan = planContentFormMigration(null);
  assert(emptyPlan.notesStashes.length === 0, `no notes stashes when there's no old blob at all (got ${emptyPlan.notesStashes.length})`);
  assert(emptyPlan.placeholderFieldIds.length === CONTENT_FORM_SCHEMA.length, "placeholders are still planned for every field even with no old data to preserve");

  console.log("\n[3] Terminal/placeholder-only old values — treated as nothing real to migrate (isRealMigratableAnswer guard)");
  const terminalPlan = planContentFormMigration({
    product_name: "N/A",
    key_messages: ["TBD", ""],
    target_audience: "Not determinable — checked 2 sources",
    notes: "Awaiting internal input",
  });
  assert(terminalPlan.notesStashes.length === 0, `every old value is a terminal placeholder, so zero notes stashes are produced (got ${terminalPlan.notesStashes.length})`);

  console.log("\n[4] Partial old blob — only product_name real, no key_messages/target_audience/notes");
  const partialPlan = planContentFormMigration({ product_name: "Anime Trimmer", key_messages: [], target_audience: null, notes: undefined });
  assert(partialPlan.notesStashes.length === 1, `exactly 1 notes stash (romance_copy only) when only product_name is real (got ${partialPlan.notesStashes.length})`);
  assert(partialPlan.notesStashes[0]?.fieldId === "romance_copy", "the one stash produced targets romance_copy");
  assert(!partialPlan.notesStashes[0]?.notesText.includes("Key messages:"), "romance_copy's Notes omits the 'Key messages:' segment entirely when there are none real");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
