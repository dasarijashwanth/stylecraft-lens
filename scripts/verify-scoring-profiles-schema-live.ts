// scripts/verify-scoring-profiles-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// scoring_profiles table (Section 29 of supabase_schema.sql) and
// tool_types.primary_criterion column (Section 30) exist and are seeded
// correctly after the user manually runs the updated SQL.
// Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-scoring-profiles-schema-live.ts

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

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("No Supabase configured in this environment — cannot verify live schema.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let ok = true;

  console.log("--- scoring_profiles (Section 29) ---");
  const { data: profiles, error: profilesError } = await supabase
    .from("scoring_profiles")
    .select("type_key, motor_weight, price_weight, feature_weight");
  if (profilesError) {
    console.log(`✗ Table "scoring_profiles": ${profilesError.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "scoring_profiles" exists (${profiles?.length ?? 0} row(s), expected 8)`);
    const expected: { typeKey: string | null; motor: number; price: number; feature: number }[] = [
      { typeKey: null, motor: 45, price: 35, feature: 20 },
      { typeKey: "clipper", motor: 45, price: 35, feature: 20 },
      { typeKey: "trimmer", motor: 45, price: 35, feature: 20 },
      { typeKey: "shaver", motor: 45, price: 35, feature: 20 },
      { typeKey: "dryer", motor: 35, price: 35, feature: 30 },
      { typeKey: "flat_iron", motor: 40, price: 35, feature: 25 },
      { typeKey: "curling_iron", motor: 40, price: 35, feature: 25 },
      { typeKey: "hot_brush", motor: 40, price: 35, feature: 25 },
    ];
    for (const exp of expected) {
      const row = profiles?.find(p => p.type_key === exp.typeKey);
      const label = exp.typeKey ?? "(global default, type_key IS NULL)";
      if (!row) {
        console.log(`  ✗ MISSING: ${label}`);
        ok = false;
        continue;
      }
      const matches = Number(row.motor_weight) === exp.motor && Number(row.price_weight) === exp.price && Number(row.feature_weight) === exp.feature;
      console.log(matches
        ? `  ✓ seeded: ${label} (${row.motor_weight}/${row.price_weight}/${row.feature_weight})`
        : `  ✗ WRONG WEIGHTS: ${label} expected ${exp.motor}/${exp.price}/${exp.feature}, got ${row.motor_weight}/${row.price_weight}/${row.feature_weight}`);
      if (!matches) ok = false;
    }
  }

  console.log("\n--- tool_types.primary_criterion (Section 30) ---");
  const { data: toolTypes, error: toolTypesError } = await supabase
    .from("tool_types")
    .select("type_key, primary_criterion");
  if (toolTypesError) {
    console.log(`✗ Column "tool_types.primary_criterion": ${toolTypesError.message}`);
    ok = false;
  } else {
    const expectedCriterion: Record<string, string> = {
      clipper: "motor", trimmer: "motor", shaver: "motor", dryer: "motor",
      flat_iron: "heat_technology", curling_iron: "heat_technology", hot_brush: "heat_technology",
      other_styling: "none", combo: "none",
    };
    for (const [typeKey, expected] of Object.entries(expectedCriterion)) {
      const row = toolTypes?.find(t => t.type_key === typeKey);
      if (!row) {
        console.log(`  ✗ MISSING tool_type row: ${typeKey}`);
        ok = false;
        continue;
      }
      const matches = row.primary_criterion === expected;
      console.log(matches ? `  ✓ ${typeKey} → ${row.primary_criterion}` : `  ✗ ${typeKey} expected "${expected}", got "${row.primary_criterion}"`);
      if (!matches) ok = false;
    }
  }

  console.log(ok ? "\nAll checks passed — scoring_profiles + tool_types.primary_criterion are fully live." : "\nSome checks failed — run the updated supabase_schema.sql (Sections 29-30).");
  process.exit(ok ? 0 : 1);
}

main();
