// scripts/verify-generation-reliability.ts
// Offline regression check for Phase 1's pipeline-reliability fixes —
// reclaimStaleRunningState's date-math and the self-heal gate's logic —
// entirely against the memoryDb fallback. No live Supabase/OpenAI/Gemini/
// Rainforest call — no .env.local is loaded, so isSupabaseConfigured
// resolves false.
//
// Run with: npx tsx scripts/verify-generation-reliability.ts

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
  const { startGenerationState, getGenerationState, reclaimStaleRunningState, updateGenerationState, STALE_RUNNING_THRESHOLD_MS } =
    await import("../lib/db/generation-state");
  const { memoryDb } = await import("../lib/memoryDb");

  // ---- Section 1: a genuinely-fresh "running" state is left untouched ----
  console.log("\n[1] Fresh running state is not reclaimed");
  await startGenerationState("proj-fresh");
  await updateGenerationState("proj-fresh", { phase: "tds", status: "running" });
  let state = await reclaimStaleRunningState("proj-fresh");
  assert(state?.status === "running", "a just-updated running state stays running");

  // ---- Section 2: a stale "running" state gets reclaimed as failed ----
  console.log("\n[2] Stale running state gets reclaimed as failed");
  await startGenerationState("proj-stale");
  await updateGenerationState("proj-stale", { phase: "tds", status: "running" });
  // Backdate updated_at past the staleness threshold directly in memoryDb —
  // this is exactly what a hard platform kill leaves behind: a row that
  // stopped advancing a while ago.
  const row = memoryDb.projectGenerationState.find(s => s.projectId === "proj-stale");
  if (row) row.updatedAt = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS - 5_000);
  state = await reclaimStaleRunningState("proj-stale");
  assert(state?.status === "failed", "a stale running state is reclaimed as failed");
  assert(!!state?.error_message && state.error_message.includes("stalled"), "reclaimed state carries an honest error message");

  // ---- Section 3: reclaimed state is now retryable ----
  console.log("\n[3] Reclaimed state is retryable (matches /pipeline/retry's own check)");
  const reclaimed = await getGenerationState("proj-stale");
  assert(reclaimed?.status === "failed", "getGenerationState reflects the reclaim persisted, not just the returned value");

  // ---- Section 4: no state row at all — reclaim is a safe no-op ----
  console.log("\n[4] Missing state row — reclaim returns null, no throw");
  const missing = await reclaimStaleRunningState("proj-never-started");
  assert(missing === null, "reclaiming a project with no state row returns null without throwing");

  // ---- Section 5: complete/failed/pending states are never touched by reclaim ----
  console.log("\n[5] complete/failed/pending states pass through reclaim untouched");
  await startGenerationState("proj-complete");
  await updateGenerationState("proj-complete", { phase: "gtm", status: "complete" });
  const completeRow = memoryDb.projectGenerationState.find(s => s.projectId === "proj-complete");
  if (completeRow) completeRow.updatedAt = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS - 5_000); // old but not "running"
  const stillComplete = await reclaimStaleRunningState("proj-complete");
  assert(stillComplete?.status === "complete", "an old but complete state is never reclassified");

  await startGenerationState("proj-pending"); // status: "pending" by default
  const pendingRow = memoryDb.projectGenerationState.find(s => s.projectId === "proj-pending");
  if (pendingRow) pendingRow.updatedAt = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS - 5_000);
  const stillPending = await reclaimStaleRunningState("proj-pending");
  assert(stillPending?.status === "pending", "an old but pending state is never reclassified (only 'running' is subject to staleness)");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
