// scripts/verify-content-form-pipeline-phase.ts
// Offline regression check for the new "content_form" pipeline phase in
// lib/project-generation-engine.ts (inserted between "gtm" and "faqs").
//
// Deliberately does NOT drive the pipeline through its real "tds" phase
// (the step that actually generates the GTM document) — that step calls
// lib/gtm-generate.ts's generateAllFields, which makes real web-search-
// fallback/Rainforest-style network calls that are NOT gated behind
// hasOpenAIKey/hasGeminiKey the way callAiForJson is, so it can hang for a
// long time even with no .env.local loaded (confirmed: an earlier version
// of this script tried exactly that and never returned). Every other
// verify-*.ts script in this repo that touches GTM generation avoids this
// the same way — either by testing deterministic sub-functions directly
// (scripts/verify-marketing-direction-flagship.ts) or by seeding state past
// the phase that would trigger it (scripts/verify-deck-phase-transition.ts
// starts straight at "deck"). This script seeds a synthetic "gtm" document
// directly via saveDocumentFields and starts generation state straight at
// "content_form", so the ONLY real work exercised is this task's own new
// code: the phase transition, the feature-flag skip path, and
// lib/content-form-generate.ts's generateContentForm (which — like
// generateMarketingDirection — only ever calls callAiForJson, safely
// returning null with no other network I/O when no AI provider is
// configured, exactly the discipline verify-marketing-direction-flagship.ts
// already established for its own sibling module).
//
// Run with: npx tsx scripts/verify-content-form-pipeline-phase.ts

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

const ORG_ID = "dev_org_id";
const USER_ID = "dev_user_id";

async function main() {
  const { createProject } = await import("../lib/db/projects");
  const { startGenerationState, updateGenerationState, getGenerationState } = await import("../lib/db/generation-state");
  const { runProjectGenerationStep } = await import("../lib/project-generation-engine");
  const { getOrCreateDocument, getDocumentByProject, getDocumentFields, saveDocumentFields } = await import("../lib/db/documents");
  const { setFeatureFlag } = await import("../lib/db/feature-flags");
  const { CONTENT_FORM_SCHEMA } = await import("../lib/content-form-field-schema");
  const { GTM_FIELD_SCHEMA } = await import("../lib/gtm-field-schema");
  const { isRealAnswer } = await import("../lib/field-answer-state");

  const projectInput = { name: "Test Project", industry: "haircare-styling", targetMarket: "pro", productName: "Rival Clipper Pro" };

  // A few real grounded facts so buildGroundedFactsBlock (lib/content-form-
  // generate.ts) has something non-empty to work with — not load-bearing
  // for these assertions (generateContentForm returns {} either way with no
  // AI key present), but closer to a real post-GTM-generation state.
  async function seedGtmDocument(projectId: string) {
    const gtmDoc = await getOrCreateDocument(projectId, "gtm");
    await saveDocumentFields(gtmDoc.id, GTM_FIELD_SCHEMA, {
      product_title: { answer: "Rival Clipper Pro", source: "derived" },
      material: { answer: "Aircraft-grade aluminum", source: "derived" },
      warranty: { answer: "2-year limited warranty", source: "derived" },
    }, USER_ID);
    return gtmDoc;
  }

  console.log("\n[1] content_form phase — generates a document, advances to faqs");
  await setFeatureFlag("content_form_generation_enabled", true);
  const projectA = await createProject(USER_ID, ORG_ID, projectInput);
  await startGenerationState(projectA.id);
  await seedGtmDocument(projectA.id);
  // Simulates "GTM generation already completed" — real production flow
  // reaches this same state via the "tds" phase's own step (see header
  // comment for why this script doesn't drive that step for real).
  await updateGenerationState(projectA.id, { phase: "content_form", status: "running" });

  const noDocYet = await getDocumentByProject(projectA.id, "content_form");
  assert(noDocYet === null, "no content_form document exists yet — it's only created once the content_form phase itself runs");

  const resultContentForm = await runProjectGenerationStep(projectA.id, ORG_ID, USER_ID);
  assert(resultContentForm.phaseCompleted === "content_form", `phaseCompleted reports "content_form" (got "${resultContentForm.phaseCompleted}")`);
  assert(resultContentForm.state.phase === "faqs", `phase advances to "faqs" (got "${resultContentForm.state.phase}")`);
  assert(resultContentForm.state.status === "running", `status is "running", not "complete"/"failed" (got "${resultContentForm.state.status}")`);

  const persisted = await getGenerationState(projectA.id);
  assert(persisted?.phase === "faqs" && persisted?.status === "running", "persisted state matches the returned state");

  const doc = await getDocumentByProject(projectA.id, "content_form");
  assert(!!doc, "a content_form document now exists");
  assert(doc?.doc_type === "content_form", `document's doc_type is "content_form" (got "${doc?.doc_type}")`);

  const fields = doc ? await getDocumentFields(doc.id) : [];
  assert(fields.length === CONTENT_FORM_SCHEMA.length, `document has exactly ${CONTENT_FORM_SCHEMA.length} fields (got ${fields.length})`);

  // No OpenAI/Gemini key is present in this process (no .env.local loaded),
  // so every field is an honest terminal placeholder, never fabricated text.
  const anyRealAnswer = fields.some(f => isRealAnswer(f.answer));
  assert(!anyRealAnswer, "with no AI provider configured, every field is a terminal placeholder rather than fabricated content");

  console.log("\n[2] content_form phase with content_form_generation_enabled OFF — skipped entirely, pipeline still advances to faqs");
  await setFeatureFlag("content_form_generation_enabled", false);
  const projectB = await createProject(USER_ID, ORG_ID, projectInput);
  await startGenerationState(projectB.id);
  await seedGtmDocument(projectB.id);
  await updateGenerationState(projectB.id, { phase: "content_form", status: "running" });

  const resultSkipped = await runProjectGenerationStep(projectB.id, ORG_ID, USER_ID);
  assert(resultSkipped.phaseCompleted === "content_form", `phaseCompleted still reports "content_form" even when skipped (got "${resultSkipped.phaseCompleted}")`);
  assert(resultSkipped.state.phase === "faqs", `phase still advances to "faqs" (got "${resultSkipped.state.phase}")`);

  const docB = await getDocumentByProject(projectB.id, "content_form");
  assert(docB === null, "no content_form document was created at all while the flag was off");

  await setFeatureFlag("content_form_generation_enabled", true); // restore default for any later script run in the same process

  console.log(`\n${passes} passed, ${failures} failed`);
  // Explicit exit — lib/db/projects.ts's createProject/getProject try a real
  // Prisma connection before falling back to memoryDb (confirmed via the
  // "Prisma failed... falling back" lines above); that failed connection
  // attempt can leave a lingering handle open that stops the process from
  // exiting on its own well after this script's own work is done. Same
  // precedent as the schema-live scripts' own explicit process.exit() calls.
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
