// scripts/verify-grooming-gate-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms
// Section 56 (grooming_gate_rules + grooming_gate_incidents, plus the
// default rule seed) and Section 57 (competitor_corrections.new_asin now
// nullable, correction_type column) of supabase_schema.sql exist after the
// user manually runs the SQL. Zero writes except a throwaway probe row that
// is deleted again, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-grooming-gate-schema-live.ts

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
  console.log("Loaded .env.local\n");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

const EXPECTED_RULE_TYPES = [
  "allow_category_segment", "block_category_segment", "required_keyword",
  "disqualifying_keyword", "trimmer_cosignal_keyword", "component_disqualifier",
  "cross_domain_use_phrase", "confidence_threshold",
];

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("No Supabase configured in this environment — cannot verify live schema.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let ok = true;

  console.log("--- grooming_gate_rules (Section 56) ---");
  const { data: rules, error: rulesErr } = await supabase
    .from("grooming_gate_rules")
    .select("id, rule_type, value, label, enabled, sort_order, created_at, updated_at");
  if (rulesErr) {
    console.log(`✗ Table "grooming_gate_rules": ${rulesErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "grooming_gate_rules" exists (${rules.length} rows)`);
    const presentTypes = new Set(rules.map(r => r.rule_type));
    for (const t of EXPECTED_RULE_TYPES) {
      if (presentTypes.has(t)) {
        console.log(`  ✓ has ${t} rows (${rules.filter(r => r.rule_type === t).length})`);
      } else {
        console.log(`  ✗ MISSING ${t} rows — the default seed INSERT (Section 56) hasn't run, or was skipped`);
        ok = false;
      }
    }
    if (rules.length === 0) {
      console.log("  ✗ Table is completely empty — the gate will reject EVERY candidate (no required_keyword can ever match). Re-run Section 56's seed INSERT.");
      ok = false;
    }
  }

  console.log("\n--- grooming_gate_incidents (Section 56) ---");
  const { error: incidentsErr } = await supabase
    .from("grooming_gate_incidents")
    .select("id, analysis_id, phase, candidate_name, candidate_asin, candidate_brand, category_path, failed_rule, detail, dismissed_at, created_at")
    .limit(1);
  if (incidentsErr) {
    console.log(`✗ Table "grooming_gate_incidents": ${incidentsErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "grooming_gate_incidents" exists (real usage data — no seed rows expected)`);
  }

  console.log("\n--- competitor_corrections (Section 57 — new_asin nullable, correction_type) ---");
  // A real insert/delete round-trip is the only reliable way to confirm a
  // column is genuinely nullable (information_schema queries would need a
  // second Supabase round-trip via raw SQL, which the JS client doesn't
  // expose directly) — same "probe insert, then clean up" approach already
  // used elsewhere in this script family when a constraint (not just a
  // column's existence) needs confirming.
  const { data: inserted, error: insertErr } = await supabase
    .from("competitor_corrections")
    .insert({ tool_type: "clipper", old_asin: "B0SCHEMAPROBE", new_asin: null, reason: "wrong_industry", correction_type: "remove" })
    .select("id, new_asin, correction_type")
    .single();
  if (insertErr) {
    console.log(`✗ Insert with new_asin:null + correction_type:'remove' failed: ${insertErr.message}`);
    ok = false;
  } else {
    console.log(`✓ new_asin accepts NULL (row id ${inserted.id})`);
    console.log(inserted.correction_type === "remove" ? `✓ correction_type column exists and stored 'remove'` : `✗ correction_type did not round-trip as expected (got ${inserted.correction_type})`);
    if (inserted.correction_type !== "remove") ok = false;
    await supabase.from("competitor_corrections").delete().eq("id", inserted.id);
    console.log("  (probe row cleaned up)");
  }

  console.log(ok ? "\nAll checks passed — grooming gate + slot-remove schema is fully live." : "\nSome checks failed — run/re-run supabase_schema.sql Sections 56-57.");
  process.exit(ok ? 0 : 1);
}

main();
