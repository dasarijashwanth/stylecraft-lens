// scripts/retry-failed-generations.ts
// One-time sweep: retries every project currently stuck at
// project_generation_state.status = "failed", now that the underlying
// checkConsistency "answer.trim is not a function" crash (and its earlier
// coerceAiAnswer-missed variant) is fixed. Mirrors scripts/backfill-gtm.ts's
// structure exactly, but targets already-failed projects instead of
// never-started ones.
//
// Run with: npx tsx scripts/retry-failed-generations.ts              # dry run — lists candidates, zero AI/Rainforest calls
//           npx tsx scripts/retry-failed-generations.ts --confirm    # makes the real calls
//
// Real cost warning: every project this touches fires a real TDS/GTM AI
// generation (and, for projects with a product URL/ASIN, a Rainforest/
// scrape call too). Review the candidate list this prints before passing
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

const MAX_STEPS_PER_PROJECT = 6; // tds -> gtm (usually 2), plus headroom for a second retry

async function main() {
  const { runProjectGenerationStep, retryFailedGeneration } = await loadEngine();

  const { data: failedStates, error: stateError } = await supabase
    .from("project_generation_state")
    .select("project_id, phase, error_message")
    .eq("status", "failed");
  if (stateError) throw stateError;
  if (!failedStates || failedStates.length === 0) {
    console.log("No projects currently stuck at status=failed. Nothing to do.");
    return;
  }

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, org_id, user_id, product_name")
    .in("id", failedStates.map((s: any) => s.project_id));
  if (projectsError) throw projectsError;

  const projectById = new Map((projects || []).map((p: any) => [p.id, p]));

  console.log(`${failedStates.length} project(s) currently stuck at status=failed:\n`);
  for (const s of failedStates) {
    const p = projectById.get(s.project_id);
    console.log(`  - ${p?.product_name || s.project_id} (phase=${s.phase}): ${s.error_message || "unknown error"}`);
  }

  const confirmed = process.argv.includes("--confirm") || process.env.RETRY_CONFIRM === "1";
  if (!confirmed) {
    console.log("\nDry run only — no AI/Rainforest calls made. Re-run with --confirm (or RETRY_CONFIRM=1) to proceed.");
    return;
  }

  console.log("\n--confirm passed — proceeding with live calls...\n");

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const s of failedStates) {
    const project = projectById.get(s.project_id);
    if (!project) {
      console.log(`✗ ${s.project_id} — project record not found, skipping`);
      failed++;
      continue;
    }
    const label = project.product_name || project.id;
    try {
      let state = await retryFailedGeneration(project.id);

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
        console.log(`✗ ${label} — failed again: ${state?.error_message || "unknown error"}`);
      } else {
        skipped++;
        console.log(`… ${label} — did not finish within ${MAX_STEPS_PER_PROJECT} steps, left in progress`);
      }
    } catch (err: any) {
      failed++;
      console.log(`✗ ${label} — threw: ${err.message || err}`);
    }
  }

  console.log(`\nDone. ${completed} completed, ${failed} failed, ${skipped} left in progress.`);
}

main().catch(err => {
  console.error("Retry script failed:", err);
  process.exit(1);
});
