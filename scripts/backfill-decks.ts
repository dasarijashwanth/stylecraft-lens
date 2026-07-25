// scripts/backfill-decks.ts
// One-time sweep: generates a Project Deck for every existing project that
// already finished GTM but never went through the new "deck" pipeline
// phase (added in Phase 3 of the Project Deck feature) — either because it
// finished under the old terminal-gtm regime before this deploy, or
// because it reached "deck" but was skipped at the time (no active
// template configured yet).
//
// Run with: npx tsx scripts/backfill-decks.ts              # dry run — counts only, zero AI calls
//           npx tsx scripts/backfill-decks.ts --confirm    # makes the real calls
//
// Selection: has a GTM document, has NO project_decks row yet, and its
// generation_state is currently sitting at phase "gtm" or "deck" with
// status "complete" (never touches "running"/"failed" rows — those are
// mid-flight or already surfaced for retry through the normal pipeline UI).
//
// Important: runProjectGenerationStep only actually calls
// generateProjectDeck() on the gtm->deck TRANSITION, not while already
// sitting at phase:"deck" — so every candidate here is explicitly reopened
// via updateGenerationState(id, {phase:"gtm", status:"running"}), NOT
// startGenerationState (which would redo snapshot+TDS+GTM unnecessarily),
// before the step loop is driven forward again.
//
// Real cost warning: this makes a real deck-rendering call per project (and
// the length-fitting AI call, only for templates with admin-set max_length
// on some token). Review the candidate count this prints before passing
// --confirm.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.substring(0, index).trim();
    let val = trimmed.substring(index + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    process.env[key] = val;
  });
  console.log("Successfully loaded environment variables from .env.local");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, "");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env or .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Must be dynamic — lib/supabase.ts (and everything it pulls in
// transitively through the engine) reads process.env at module-load time.
async function loadEngine() {
  const [{ runProjectGenerationStep }, generationState] = await Promise.all([
    import("../lib/project-generation-engine"),
    import("../lib/db/generation-state"),
  ]);
  return { runProjectGenerationStep, ...generationState };
}

const MAX_STEPS_PER_PROJECT = 3; // gtm(running) -> deck(complete), plus headroom

async function main() {
  const { runProjectGenerationStep, updateGenerationState, getGenerationState } = await loadEngine();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, org_id, user_id, product_name");
  if (projectsError) throw projectsError;
  if (!projects || projects.length === 0) {
    console.log("No projects found.");
    return;
  }

  const { data: gtmDocs, error: gtmError } = await supabase
    .from("documents")
    .select("project_id")
    .eq("doc_type", "gtm");
  if (gtmError) throw gtmError;
  const projectsWithGtm = new Set((gtmDocs || []).map((d: any) => d.project_id));

  const { data: deckRows, error: deckError } = await supabase
    .from("project_decks")
    .select("project_id");
  if (deckError) throw deckError;
  const projectsWithDeck = new Set((deckRows || []).map((d: any) => d.project_id));

  const { data: stateRows, error: stateError } = await supabase
    .from("project_generation_state")
    .select("project_id, phase, status");
  if (stateError) throw stateError;
  const stateByProject = new Map((stateRows || []).map((s: any) => [s.project_id, s]));

  const toProcess = projects.filter((p: any) => {
    if (!projectsWithGtm.has(p.id) || projectsWithDeck.has(p.id)) return false;
    const state = stateByProject.get(p.id);
    return !!state && (state.phase === "gtm" || state.phase === "deck") && state.status === "complete";
  });

  console.log(`${projects.length} total projects, ${toProcess.length} have a GTM document, no deck yet, and a "complete" state ready to reopen. Candidates for backfill.`);

  const confirmed = process.argv.includes("--confirm") || process.env.BACKFILL_CONFIRM === "1";
  if (!confirmed) {
    console.log("\nDry run only — no deck-rendering/AI calls made. Re-run with --confirm (or BACKFILL_CONFIRM=1) to proceed.");
    return;
  }
  if (toProcess.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\n--confirm passed — proceeding with real deck generation...\n");

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const project of toProcess) {
    const label = project.product_name || project.id;
    try {
      await updateGenerationState(project.id, { phase: "gtm", status: "running" });

      let state = await getGenerationState(project.id);
      let steps = 0;
      let finalStatus = state?.status;
      while (state && state.status !== "complete" && state.status !== "failed" && steps < MAX_STEPS_PER_PROJECT) {
        const result = await runProjectGenerationStep(project.id, project.org_id, project.user_id);
        state = result.state;
        finalStatus = state.status;
        steps++;
      }

      if (finalStatus === "complete") {
        completed++;
        console.log(`✓ ${label} — completed`);
      } else if (finalStatus === "failed") {
        failed++;
        console.log(`✗ ${label} — failed: ${state?.error_message || "unknown error"}`);
      } else {
        skipped++;
        console.log(`… ${label} — did not finish within ${MAX_STEPS_PER_PROJECT} steps, left in progress`);
      }
    } catch (err: any) {
      failed++;
      console.log(`✗ ${label} — threw: ${err.message || err}`);
    }
  }

  console.log(`\nDone. ${completed} completed, ${failed} failed, ${skipped} left in progress, out of ${toProcess.length} candidates.`);
  console.log(`Note: "completed" here means the pipeline step reached phase "deck" — check each project's Project Deck tab for whether a deck actually rendered (a missing active template or a real render error still completes the step but leaves no/a failed deck row, by design).`);
}

main().catch(err => {
  console.error("Backfill script failed:", err);
  process.exit(1);
});
