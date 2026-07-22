// scripts/verify-field-lifecycle.ts
// Offline regression check for Phase 3 (fill-everything / eliminate N/A):
// field-answer-state predicates, field-finalize terminal states, tier-6
// derivation ordering (never preempts a real web-search answer),
// category-defaults, tds-gtm-reconcile's copy-only logic, and
// saveDocumentFields/updateDocumentField's owner-default and
// manual-edit-source-tag behavior. All pure-function or memoryDb-backed —
// no live Rainforest/OpenAI/Gemini/Supabase call, no .env.local loaded.
//
// Run with: npx tsx scripts/verify-field-lifecycle.ts

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
  const { isRealAnswer, isNotDeterminable, isAwaitingInternalInput, buildFillReport, TDS_NOT_LISTED } = await import("../lib/field-answer-state");
  const { finalizeFieldAnswers } = await import("../lib/field-finalize");
  const { applyTier6Inference, deriveGoodBetterBest, inferHairType } = await import("../lib/gtm-tier6-inference");
  const { getCategoryDefault } = await import("../lib/category-defaults");
  const { reconcileTdsFromGtm } = await import("../lib/tds-gtm-reconcile");
  const { getOrCreateDocument, saveDocumentFields, getDocumentFields, updateDocumentField } = await import("../lib/db/documents");
  const { TDS_FIELD_SCHEMA } = await import("../lib/tds-field-schema");

  // ---- Section 1: field-answer-state predicates ----
  console.log("\n[1] field-answer-state predicates");
  assert(isRealAnswer("Ceramic housing") === true, "a real value is real");
  assert(isRealAnswer("N/A") === false, "bare N/A is not real");
  assert(isRealAnswer("TBD") === false, "bare TBD is not real");
  assert(isRealAnswer(TDS_NOT_LISTED) === false, "TDS's not-listed sentinel is not real");
  assert(isRealAnswer("Awaiting internal input") === false, "awaiting-internal-input is not real");
  assert(isRealAnswer("Not determinable — no source found") === false, "not-determinable is not real");
  assert(isRealAnswer("") === false, "empty string is not real");
  assert(isRealAnswer(null) === false, "null is not real");
  assert(isNotDeterminable("Not determinable — no source found") === true, "not-determinable detected");
  assert(isNotDeterminable("N/A") === false, "bare N/A is NOT the not-determinable state");
  assert(isAwaitingInternalInput("Awaiting internal input") === true, "awaiting-internal-input detected");
  assert(isAwaitingInternalInput("N/A") === false, "bare N/A is NOT awaiting-internal-input");

  const report = buildFillReport(
    {
      a: { answer: "Real value", source: "tds" },
      b: { answer: "Awaiting internal input", source: "none" },
      c: { answer: "Not determinable — x", source: "none" },
      d: { answer: "N/A", source: "none" },
    },
    [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]
  );
  assert(report.total === 4, "fill report counts every schema field");
  assert(report.filled === 1, "fill report counts exactly 1 real answer");
  assert(report.bySource.tds === 1, "fill report buckets the real answer by its source");
  assert(report.awaitingInternalInput === 1, "fill report counts exactly 1 awaiting-internal-input");
  assert(report.notDeterminable === 1, "fill report counts exactly 1 not-determinable");

  // ---- Section 2: field-finalize terminal states ----
  console.log("\n[2] finalizeFieldAnswers terminal states");
  const finalizeSchema = [
    { id: "real_field", kind: "grounded" as const },
    { id: "stuck_grounded", kind: "grounded" as const },
    { id: "stuck_internal", kind: "internal" as const },
  ];
  const finalized = finalizeFieldAnswers(
    {
      real_field: { answer: "A real spec", source: "tds" },
      stuck_grounded: { answer: "N/A", source: "none" },
      stuck_internal: { answer: "N/A", source: "none" },
    },
    finalizeSchema,
    "not found anywhere"
  );
  assert(finalized.real_field.answer === "A real spec", "a real answer is left untouched by finalize");
  assert(finalized.stuck_grounded.answer === "Not determinable — not found anywhere", "a stuck grounded field becomes Not determinable with the given reason");
  assert(finalized.stuck_internal.answer === "Awaiting internal input", "a stuck internal field becomes Awaiting internal input, not Not determinable");
  assert(finalized.stuck_grounded.source === "none" && finalized.stuck_internal.source === "none", "finalized terminal states are tagged source: none");

  // ---- Section 3: tier-6 derivation — pure correctness + never preempts a real answer ----
  console.log("\n[3] deriveGoodBetterBest / inferHairType / applyTier6Inference ordering");
  const cheapResult = deriveGoodBetterBest({
    target_price: "$10",
    competitor_prices: [{ price_raw: 100 }, { price_raw: 200 }, { price_raw: 300 }, { price_raw: 400 }, { price_raw: 500 }, { price_raw: 600 }],
  });
  assert(cheapResult?.answer === "Good", "deriveGoodBetterBest correctly buckets the cheapest of 7 compared prices into Good");
  assert(deriveGoodBetterBest(null) === null, "deriveGoodBetterBest returns null with no pricing analysis");

  assert(!!inferHairType("designed for curly and coily hair types")?.answer.includes("Curly/Coily"), "inferHairType matches a real keyword");
  assert(inferHairType("") === null, "inferHairType returns null with no source text");

  const tier6Schema = [{ id: "good_better_best" }, { id: "hair_type" }];
  const alreadyWebAnswered: Record<string, any> = {
    good_better_best: { answer: "Best", source: "web" },
    hair_type: { answer: "N/A", source: "none" },
  };
  applyTier6Inference(alreadyWebAnswered, tier6Schema, {
    pricingAnalysis: { target_price: "$50", competitor_prices: [{ price_raw: 100 }, { price_raw: 20 }] },
    hairTypeSourceText: "designed for curly and coily hair types",
  });
  assert(
    alreadyWebAnswered.good_better_best.answer === "Best" && alreadyWebAnswered.good_better_best.source === "web",
    "a real web-sourced good_better_best answer is never overwritten by tier 6 — the exact reordering bug this fixes"
  );
  assert(alreadyWebAnswered.hair_type.answer.includes("Curly/Coily"), "hair_type derives from keyword match once still unresolved after web search");
  assert(alreadyWebAnswered.hair_type.source === "derived", "derived hair_type is tagged source: derived");

  // ---- Section 4: category-defaults (tier 7) ----
  console.log("\n[4] getCategoryDefault");
  assert(getCategoryDefault("Hair Dryers", "hair_type") === "All Hair Types", "hair dryer category default for hair_type");
  assert(getCategoryDefault("Hair Dryers", "warranty") === null, "warranty is never a category default (legal commitment, excluded on purpose)");
  assert(getCategoryDefault(null, "material") === null, "no category means no default");
  assert(getCategoryDefault("Some Unknown Category", "material") === null, "unmatched category means no default");

  // ---- Section 5: reconcileTdsFromGtm — copy-only, never overwrites ----
  // Uses real, shared TDS/GTM field ids (manufacturer, warranty) —
  // reconcile iterates the real TDS_FIELD_SCHEMA, so a made-up field id
  // outside that schema would silently never be considered.
  console.log("\n[5] reconcileTdsFromGtm — copies real GTM answers into unresolved TDS fields only");
  const tdsDoc = await getOrCreateDocument("test-reconcile-project", "tds");
  await saveDocumentFields(
    tdsDoc.id,
    TDS_FIELD_SCHEMA,
    {
      manufacturer: { answer: TDS_NOT_LISTED, source: "none" },
      warranty: { answer: "1 year (already captured from snapshot)", source: "amazon" },
    },
    "system"
  );

  const copied = await reconcileTdsFromGtm("test-reconcile-project", "system", {
    manufacturer: { answer: "Stylecraft Inc.", source: "sales_kit" },
    warranty: { answer: "5 years (from GTM web search — should NOT overwrite)", source: "web" },
  });
  assert(copied === 1, "reconcile reports exactly 1 field copied");

  const tdsFieldsAfter = await getDocumentFields(tdsDoc.id);
  const manufacturerAfter = tdsFieldsAfter.find(f => f.field_id === "manufacturer")!;
  const warrantyAfter = tdsFieldsAfter.find(f => f.field_id === "warranty")!;
  assert(manufacturerAfter.answer === "Stylecraft Inc." && manufacturerAfter.source === "gtm_cross_fill", "unresolved TDS field is cross-filled from GTM, tagged gtm_cross_fill");
  assert(warrantyAfter.answer === "1 year (already captured from snapshot)", "a TDS field that already has a real answer is NEVER overwritten by reconcile");

  // ---- Section 6: saveDocumentFields owner default + manual-edit source tagging ----
  console.log("\n[6] saveDocumentFields owner default + updateDocumentField manual-edit tagging");
  const ownerSchema = [{ id: "approved_pricing", section: "General", question: "Approved Pricing", owner: "Sales" }];
  const ownerDoc = await getOrCreateDocument("test-owner-project", "gtm");
  await saveDocumentFields(ownerDoc.id, ownerSchema, { approved_pricing: { answer: "$259.95", source: "project_record" } }, "system");
  const ownerFields = await getDocumentFields(ownerDoc.id);
  assert(ownerFields.find(f => f.field_id === "approved_pricing")!.owner === "Sales", "internal field's first save defaults to its schema-declared owner");

  const manualEdited = await updateDocumentField(ownerDoc.id, "approved_pricing", "$269.95", "user_1");
  assert(manualEdited.source === "manual_edit", "a plain manual edit (no opts) tags source as manual_edit");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
