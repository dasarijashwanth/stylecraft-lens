// scripts/verify-editable-gate-rules-live.ts
// Offline regression check proving the grooming/beauty industry gate's
// rules are genuinely live-editable, and that this is what makes
// fetchReplacementForSlot's "always fetch groomingGateRules fresh, never
// cache" design (lib/analysisEngine.ts) actually matter: adds a new
// disqualifying_keyword rule via addGroomingGateRule, confirms
// listGroomingGateRules() reflects it immediately, and shows the SAME
// synthetic candidate flip from allowed to rejected when re-gated with the
// freshly-read rules list captured after the add vs. before it. No live
// API calls — routes through memoryDb (no .env.local loaded).
//
// Run with: npx tsx scripts/verify-editable-gate-rules-live.ts

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
  const { passesGroomingIndustryGate } = await import("../lib/grooming-industry-gate");
  const { listGroomingGateRules, addGroomingGateRule, deleteGroomingGateRule } = await import("../lib/db/grooming-gate-rules");
  const { listToolTypes } = await import("../lib/db/tool-types");

  const toolTypes = await listToolTypes();
  const TEST_VALUE = "widget";

  // memoryDb persists rule additions across script runs (.local-data
  // snapshot) — scrub any leftover "widget" rule from a previous run first
  // so the "before" assertion below starts from a genuinely clean, known
  // state every time this script runs.
  const preexisting = (await listGroomingGateRules()).filter(r => r.rule_type === "disqualifying_keyword" && r.value.toLowerCase() === TEST_VALUE);
  for (const r of preexisting) {
    await deleteGroomingGateRule(r.id);
  }

  const candidate = { name: "SuperWidget Pro Trimmer", description: "a great widget attachment for precision trimming" };

  console.log("\n[1] before the rule exists — the candidate is allowed");
  const rulesBefore = await listGroomingGateRules();
  assert(!rulesBefore.some(r => r.rule_type === "disqualifying_keyword" && r.value.toLowerCase() === TEST_VALUE), "no 'widget' disqualifying_keyword rule exists yet");
  const beforeResult = passesGroomingIndustryGate(candidate, rulesBefore, { stage: "post_enrichment", toolTypes });
  assert(beforeResult.ok === true, `the candidate passes the gate before the new rule exists (got ok=${beforeResult.ok}, reason=${beforeResult.reason})`);

  console.log("\n[2] addGroomingGateRule — the admin-editable rule list picks it up immediately");
  const added = await addGroomingGateRule({ ruleType: "disqualifying_keyword", value: TEST_VALUE, label: "Test-only rule (verify-editable-gate-rules-live)" });
  assert(added.enabled === true, "a newly-added rule is enabled by default");
  const rulesAfter = await listGroomingGateRules();
  assert(rulesAfter.some(r => r.id === added.id && r.rule_type === "disqualifying_keyword" && r.value === TEST_VALUE), "listGroomingGateRules() reflects the new rule immediately after adding it");

  console.log("\n[3] after the rule exists — the SAME candidate is now rejected when re-gated with freshly-read rules");
  const afterResult = passesGroomingIndustryGate(candidate, rulesAfter, { stage: "post_enrichment", toolTypes });
  assert(afterResult.ok === false, `the same candidate is now rejected (got ok=${afterResult.ok})`);
  assert(afterResult.reason === "disqualifying_keyword", `rejected specifically via the new disqualifying_keyword rule (got reason=${afterResult.reason})`);
  assert(afterResult.detail === TEST_VALUE, `the rejection detail names the matched rule value (got ${afterResult.detail})`);

  // Re-gating with the STALE (pre-add) rules list must still allow it —
  // this is the actual point being proven: it's re-fetching the rules list
  // fresh (as fetchReplacementForSlot/removeCompetitorSlot/
  // refillCompetitorSlot all do, never caching it) that makes an admin's
  // edit take effect on the very next call, not some retroactive rewrite
  // of an already-computed gate result.
  const staleResult = passesGroomingIndustryGate(candidate, rulesBefore, { stage: "post_enrichment", toolTypes });
  assert(staleResult.ok === true, "re-gating with the STALE (captured-before-the-add) rules list still allows the candidate — proves the flip comes from re-reading the rules, not a global side effect");

  // Cleanup — leave memoryDb's rule list as this script found it.
  await deleteGroomingGateRule(added.id);
  const rulesAfterCleanup = await listGroomingGateRules();
  assert(!rulesAfterCleanup.some(r => r.id === added.id), "test-only rule removed again — memoryDb left as this script found it");

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
