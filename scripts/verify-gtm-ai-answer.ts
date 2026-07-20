// scripts/verify-gtm-ai-answer.ts
// Offline regression check for the ai_answer column (GTM/TDS document
// fields) — proves saveDocumentFields/updateDocumentField correctly
// preserve the AI-generated answer across manual edits, entirely against
// the memoryDb fallback. No live Rainforest/OpenAI/Gemini/Supabase call —
// no .env.local is loaded, so isSupabaseConfigured resolves false.
//
// Run with: npx tsx scripts/verify-gtm-ai-answer.ts

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
  const { getOrCreateDocument, saveDocumentFields, updateDocumentField, getDocumentFields, revertDocumentField } = await import("../lib/db/documents");

  const schema = [{ id: "core_consumer", section: "General", question: "Who is the core consumer?" }];

  const doc = await getOrCreateDocument("test-project-1", "gtm");

  // ---- Section 1: bulk save (simulates full AI generation) sets both ----
  console.log("\n[1] Bulk generation sets answer AND ai_answer");
  await saveDocumentFields(doc.id, schema, { core_consumer: { answer: "Busy home stylists", source: "sales_kit" } }, "system");
  let fields = await getDocumentFields(doc.id);
  let field = fields.find(f => f.field_id === "core_consumer")!;
  assert(field.answer === "Busy home stylists", "answer set from bulk generation");
  assert(field.ai_answer === "Busy home stylists", "ai_answer set from bulk generation");

  // ---- Section 2: plain manual edit (opts omitted) must NOT move ai_answer ----
  console.log("\n[2] Manual edit (PATCH, no opts) leaves ai_answer untouched");
  await updateDocumentField(doc.id, "core_consumer", "Busy home stylists AND barbershops", "user_1");
  fields = await getDocumentFields(doc.id);
  field = fields.find(f => f.field_id === "core_consumer")!;
  assert(field.answer === "Busy home stylists AND barbershops", "answer reflects the manual edit");
  assert(field.ai_answer === "Busy home stylists", "ai_answer still holds the original AI value");

  // ---- Section 3: AI-driven regenerate (opts provided) moves BOTH ----
  console.log("\n[3] Regenerate (opts provided) re-baselines ai_answer too");
  await updateDocumentField(doc.id, "core_consumer", "Professional salon stylists", "user_1", { source: "web", flagged: false });
  fields = await getDocumentFields(doc.id);
  field = fields.find(f => f.field_id === "core_consumer")!;
  assert(field.answer === "Professional salon stylists", "answer reflects the regenerated value");
  assert(field.ai_answer === "Professional salon stylists", "ai_answer re-baselined to the new AI value");

  // ---- Section 4: CSV "edited" derivation logic (mirrors export-csv/route.ts) ----
  console.log("\n[4] CSV edited-column derivation");
  await updateDocumentField(doc.id, "core_consumer", "Professional salon stylists (edited by hand)", "user_1");
  fields = await getDocumentFields(doc.id);
  field = fields.find(f => f.field_id === "core_consumer")!;
  const aiOriginal = (field.ai_answer ?? "").trim();
  const trimmed = (field.answer ?? "").trim();
  const editedByUser = aiOriginal !== "" && aiOriginal !== trimmed;
  assert(editedByUser === true, "edited field is correctly flagged as edited");
  assert(aiOriginal === "Professional salon stylists", "AI Original column would show the pre-edit AI value");

  // A field that's never been touched by a human should NOT show as edited.
  await saveDocumentFields(doc.id, schema, { core_consumer: { answer: "Fresh AI answer", source: "tds" } }, "system");
  fields = await getDocumentFields(doc.id);
  field = fields.find(f => f.field_id === "core_consumer")!;
  const aiOriginal2 = (field.ai_answer ?? "").trim();
  const trimmed2 = (field.answer ?? "").trim();
  const editedByUser2 = aiOriginal2 !== "" && aiOriginal2 !== trimmed2;
  assert(editedByUser2 === false, "never-edited (freshly regenerated) field is NOT flagged as edited");

  // ---- Section 5: revert must not resurrect a stale ai_answer incorrectly ----
  console.log("\n[5] Revert restores answer via history, ai_answer stays as last AI baseline");
  await updateDocumentField(doc.id, "core_consumer", "Hand-typed override", "user_1");
  const reverted = await revertDocumentField(doc.id, "core_consumer", "user_1");
  assert(reverted.answer === "Fresh AI answer", "revert restored the prior value from history");
  assert(reverted.ai_answer === "Fresh AI answer", "ai_answer unaffected by revert (opts omitted on revert's own call)");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
