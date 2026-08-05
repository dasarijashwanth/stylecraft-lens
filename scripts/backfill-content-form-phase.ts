// scripts/backfill-content-form-phase.ts
// One-time sweep: unblocks the "content_form" pipeline phase for every
// existing project that finished the auto-generation pipeline BEFORE that
// phase existed in the state machine (lib/db/generation-state.ts's
// GenerationPhase enum). Root cause: runProjectGenerationStep short-circuits
// immediately for any project whose status is already "complete"
// (lib/project-generation-engine.ts:49-51), and the only thing that ever
// calls /pipeline/continue is ProjectGenerationProgress, which only renders
// while status !== "complete" — so a phase added after a project's pipeline
// already finished is otherwise permanently unreachable for it. This
// re-seeds generation_state at {phase:"content_form", status:"pending"} via
// the SAME startGenerationState primitive scripts/backfill-gtm.ts already
// established for exactly this "resume an existing pipeline row" case, then
// drives runProjectGenerationStep forward for real — NOT
// scripts/migrate-content-form.ts's placeholder-only seeding, which
// deliberately never fabricates real copy and is not a substitute for this.
//
// Selection: project_generation_state.status === "complete" (finished the
// pipeline) AND no REAL (non-placeholder, non-empty) content_form field
// exists yet — covers both "no content_form document at all" and "a
// document exists with only migrate-content-form.ts's 'pending
// regeneration' placeholders," so re-running this after that migration
// script is safe and still finds the right candidates.
//
// Run with: npx tsx scripts/backfill-content-form-phase.ts              # dry run — counts only, zero AI calls
//           npx tsx scripts/backfill-content-form-phase.ts --confirm    # makes the real calls
//
// Real cost warning: every project this touches fires a real Content Form
// AI generation call (and, since it re-enters the pipeline at
// "content_form", also faqs/marketing_direction/deck — all best-effort,
// same as the normal pipeline). Review the candidate count before
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

// .env.local's NEXT_PUBLIC_SUPABASE_URL has, in the past, ended up with a
// stray /rest/v1 suffix baked in — supabase-js appends its own /rest/v1
// internally, so a pre-existing suffix breaks every call ("Invalid path
// specified in request URL"). Stripping it is a no-op when already correct.
const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, "");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env or .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Must be dynamic — lib/supabase.ts (and everything it pulls in transitively
// through the engine) reads process.env at module-load time. A plain
// top-level `import` would be hoisted ahead of the manual .env.local loading
// above and pick up an unconfigured placeholder client.
async function loadEngine() {
  const [{ runProjectGenerationStep }, generationState, fieldAnswerState] = await Promise.all([
    import("../lib/project-generation-engine"),
    import("../lib/db/generation-state"),
    import("../lib/field-answer-state"),
  ]);
  return { runProjectGenerationStep, ...generationState, ...fieldAnswerState };
}

// content_form -> faqs -> marketing_direction -> deck -> complete, plus
// headroom for a retry.
const MAX_STEPS_PER_PROJECT = 6;

async function main() {
  const { runProjectGenerationStep, getGenerationState, startGenerationState, isRealAnswer } = await loadEngine();

  const { data: stateRows, error: stateError } = await supabase
    .from("project_generation_state")
    .select("project_id, status")
    .eq("status", "complete");
  if (stateError) throw stateError;
  if (!stateRows || stateRows.length === 0) {
    console.log("No projects have completed the pipeline yet — nothing to backfill.");
    return;
  }

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, org_id, user_id, product_name")
    .in("id", stateRows.map((s: any) => s.project_id));
  if (projectsError) throw projectsError;

  const { data: cfDocs, error: cfDocsError } = await supabase
    .from("documents")
    .select("id, project_id")
    .eq("doc_type", "content_form");
  if (cfDocsError) throw cfDocsError;
  const cfDocByProject = new Map((cfDocs || []).map((d: any) => [d.project_id, d.id]));

  const cfDocIds = (cfDocs || []).map((d: any) => d.id);
  const realFieldProjectIds = new Set<string>();
  if (cfDocIds.length > 0) {
    const { data: cfFields, error: cfFieldsError } = await supabase
      .from("document_fields")
      .select("document_id, answer")
      .in("document_id", cfDocIds);
    if (cfFieldsError) throw cfFieldsError;
    const docToProject = new Map((cfDocs || []).map((d: any) => [d.id, d.project_id]));
    for (const f of cfFields || []) {
      if (isRealAnswer(f.answer)) {
        const pid = docToProject.get(f.document_id);
        if (pid) realFieldProjectIds.add(pid);
      }
    }
  }

  const toProcess = (projects || []).filter((p: any) => !realFieldProjectIds.has(p.id));
  console.log(
    `${stateRows.length} projects finished the pipeline. ${toProcess.length} have no real Content Form content yet (no document, or placeholder-only) — candidates for backfill.`
  );

  const confirmed = process.argv.includes("--confirm") || process.env.BACKFILL_CONFIRM === "1";
  if (!confirmed) {
    console.log("\nDry run only — no AI calls made. Re-run with --confirm (or BACKFILL_CONFIRM=1) to proceed.");
    return;
  }
  if (toProcess.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\n--confirm passed — proceeding with live calls...\n");

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const project of toProcess) {
    const label = project.product_name || project.id;
    try {
      let state = await startGenerationState(project.id, { phase: "content_form" });

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

  console.log(`\nDone. ${completed} completed, ${failed} failed, ${skipped} left in progress, ${projects!.length - toProcess.length} already had real Content Form content.`);
}

main().catch(err => {
  console.error("Backfill script failed:", err);
  process.exit(1);
});
