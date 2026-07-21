// scripts/backfill-gtm.ts
// One-time sweep: drives the auto-generation pipeline to completion for
// every existing project that never went through it, so every project ends
// up with a generated TDS + GTM without requiring anyone to open it.
//
// Run with: npx tsx scripts/backfill-gtm.ts              # dry run — counts only, zero AI/Rainforest calls
//           npx tsx scripts/backfill-gtm.ts --confirm    # makes the real calls
//
// Selection is "no project_generation_state row at all" — NOT "no GTM
// document." A live production check found several legacy projects that
// already have a GTM doc via an older, separate manual-generate route that
// predates this auto-pipeline, but have NO TDS doc at all (TDS has no other
// generation path than this pipeline) and no state row — those are exactly
// the projects this backfill exists for, and a GTM-doc-based filter would
// silently skip every one of them.
//
// Safe to re-run: any project whose state row is already "complete" is
// skipped (checked fresh each run, not cached).
//
// Real cost warning: every project this touches fires a real TDS + GTM AI
// generation (and, for projects with a product URL/ASIN, a Rainforest/
// scrape call too). Review the candidate count this prints before passing
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
  const [{ runProjectGenerationStep }, generationState] = await Promise.all([
    import("../lib/project-generation-engine"),
    import("../lib/db/generation-state"),
  ]);
  return { runProjectGenerationStep, ...generationState };
}

const MAX_STEPS_PER_PROJECT = 6; // pending -> snapshot -> tds -> gtm, plus headroom for retries

async function main() {
  const { runProjectGenerationStep, getGenerationState, startGenerationState, retryFailedGeneration } = await loadEngine();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, org_id, user_id, product_name");
  if (projectsError) throw projectsError;
  if (!projects || projects.length === 0) {
    console.log("No projects found.");
    return;
  }

  const { data: tdsDocs, error: tdsError } = await supabase
    .from("documents")
    .select("project_id")
    .eq("doc_type", "tds");
  if (tdsError) throw tdsError;
  const projectsWithTds = new Set((tdsDocs || []).map((d: any) => d.project_id));

  const { data: stateRows, error: stateError } = await supabase
    .from("project_generation_state")
    .select("project_id");
  if (stateError) throw stateError;
  const projectsWithState = new Set((stateRows || []).map((s: any) => s.project_id));

  const toProcess = projects.filter((p: any) => !projectsWithState.has(p.id));
  console.log(`${projects.length} total projects, ${toProcess.length} never went through the auto-pipeline (no generation_state row). Candidates for backfill.`);

  const confirmed = process.argv.includes("--confirm") || process.env.BACKFILL_CONFIRM === "1";
  if (!confirmed) {
    console.log("\nDry run only — no AI/Rainforest calls made. Re-run with --confirm (or BACKFILL_CONFIRM=1) to proceed.");
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
      let state = await getGenerationState(project.id);

      if (!state) {
        // Seed at "tds" if a TDS document already exists (skip redoing
        // snapshot/TDS work that's already done), otherwise start fresh.
        state = await startGenerationState(project.id, { phase: projectsWithTds.has(project.id) ? "tds" : "pending" });
      } else if (state.status === "failed") {
        state = await retryFailedGeneration(project.id);
      } else if (state.status === "complete") {
        // Has a state row marked complete but no GTM document somehow —
        // shouldn't happen, but re-seed at "tds" defensively rather than
        // silently skipping a project that genuinely needs one.
        state = await startGenerationState(project.id, { phase: "tds" });
      }

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

  console.log(`\nDone. ${completed} completed, ${failed} failed, ${skipped} left in progress, ${projects.length - toProcess.length} already had a generation_state row.`);
}

main().catch(err => {
  console.error("Backfill script failed:", err);
  process.exit(1);
});
