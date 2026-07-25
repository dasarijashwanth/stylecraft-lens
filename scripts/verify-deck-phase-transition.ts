// scripts/verify-deck-phase-transition.ts
// Offline regression check for Phase 3's pipeline change — the new
// "deck" phase in lib/project-generation-engine.ts — entirely against the
// memoryDb fallback. No .env.local is loaded (isSupabaseConfigured
// resolves false, and there's no OPENAI_API_KEY in this process even if a
// code path tried to use one), so this cannot make a live Supabase/
// OpenAI/Gemini/Rainforest call under any circumstance.
//
// Run with: npx tsx scripts/verify-deck-phase-transition.ts
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

const ORG_ID = "dev_org_id";
const USER_ID = "dev_user_id";

async function main() {
  const { createProject } = await import("../lib/db/projects");
  const { startGenerationState, updateGenerationState, getGenerationState } = await import("../lib/db/generation-state");
  const { runProjectGenerationStep } = await import("../lib/project-generation-engine");
  const { getLatestProjectDeck } = await import("../lib/db/project-decks");
  const { createDeckTemplate, setActiveDeckTemplate } = await import("../lib/db/deck-templates");
  const { parseDeckTemplate } = await import("../lib/deck-template-parser");
  const { buildDefaultPlaceholderMap } = await import("../lib/deck-field-registry");

  const projectInput = { name: "Test Project", industry: "haircare-styling", targetMarket: "pro", productName: "Rival Clipper Pro" };

  console.log("\n[1] gtm -> deck transition with NO active template — degrades gracefully, never fails the step");
  const projectA = await createProject(USER_ID, ORG_ID, projectInput);
  await startGenerationState(projectA.id);
  await updateGenerationState(projectA.id, { phase: "gtm", status: "running" }); // simulate TDS+GTM already done

  const resultA = await runProjectGenerationStep(projectA.id, ORG_ID, USER_ID);
  assert(resultA.state.phase === "deck", `phase advances to "deck" (got "${resultA.state.phase}")`);
  assert(resultA.state.status === "complete", `status is "complete", not "failed" (got "${resultA.state.status}")`);
  assert(resultA.phaseCompleted === "deck", `phaseCompleted reports "deck" (got "${resultA.phaseCompleted}")`);

  const persistedA = await getGenerationState(projectA.id);
  assert(persistedA?.phase === "deck" && persistedA?.status === "complete", "persisted state matches the returned state");

  const deckA = await getLatestProjectDeck(projectA.id);
  assert(deckA === null, "no project_decks row was created when there is no active template (nothing to generate)");

  console.log("\n[2] gtm -> deck transition WITH a real active template — deck actually generates, zero AI calls");
  const fixtureBuffer = readFileSync(path.resolve(process.cwd(), "scratch", "starter-deck-template.pptx"));
  const parsed = await parseDeckTemplate(fixtureBuffer);
  const placeholderMap = buildDefaultPlaceholderMap(parsed);
  assert(placeholderMap.tokens.every(t => !t.max_length), "sanity check: default placeholder map sets no max_length on any token, so condense never has anything to do (guarantees zero OpenAI calls even if a key were present)");

  const template = await createDeckTemplate({
    name: "Verify Template",
    fileBuffer: fixtureBuffer,
    fileName: "starter-deck-template.pptx",
    slideCount: parsed.slideCount,
    placeholderMap,
  });
  await setActiveDeckTemplate(template.id);

  const projectB = await createProject(USER_ID, ORG_ID, projectInput);
  await startGenerationState(projectB.id);
  await updateGenerationState(projectB.id, { phase: "gtm", status: "running" });

  const resultB = await runProjectGenerationStep(projectB.id, ORG_ID, USER_ID);
  assert(resultB.state.phase === "deck" && resultB.state.status === "complete", `step completes at phase "deck" (got phase="${resultB.state.phase}" status="${resultB.state.status}")`);

  const deckB = await getLatestProjectDeck(projectB.id);
  assert(!!deckB, "a project_decks row now exists for this project");
  assert(deckB?.status === "complete", `the deck row is "complete" (got "${deckB?.status}")`);
  assert(!!deckB?.file_size_bytes && deckB.file_size_bytes > 0, `the deck row has real, non-empty file bytes (got ${deckB?.file_size_bytes})`);
  assert(Array.isArray(deckB?.slides_removed), "slides_removed is recorded as an array");

  console.log("\n[3] gtm -> deck transition where deck generation genuinely fails — pipeline step still completes, failure is recorded on the deck row");
  const brokenTemplate = await createDeckTemplate({
    name: "Broken Template",
    fileBuffer: Buffer.from("this is not a valid pptx zip file"),
    fileName: "broken.pptx",
    slideCount: 0,
    placeholderMap,
  });
  await setActiveDeckTemplate(brokenTemplate.id);

  const projectC = await createProject(USER_ID, ORG_ID, projectInput);
  await startGenerationState(projectC.id);
  await updateGenerationState(projectC.id, { phase: "gtm", status: "running" });

  const resultC = await runProjectGenerationStep(projectC.id, ORG_ID, USER_ID);
  assert(resultC.state.phase === "deck" && resultC.state.status === "complete", `pipeline step still completes despite a real deck-generation error (got phase="${resultC.state.phase}" status="${resultC.state.status}")`);

  const deckC = await getLatestProjectDeck(projectC.id);
  assert(deckC?.status === "failed", `the deck row itself is correctly marked "failed" (got "${deckC?.status}")`);
  assert(!!deckC?.error_message, `the deck row carries a real error message ("${deckC?.error_message}")`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
