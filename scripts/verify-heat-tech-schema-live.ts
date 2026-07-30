// scripts/verify-heat-tech-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// heat_tech_families table (Section 31 of supabase_schema.sql) is seeded
// with the 4 built-in families, and that branded_heat_tech_names
// (Section 32) exists (admin-filled, starts empty — real usage data, not
// pre-seeded) after the user manually runs the updated SQL.
// Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-heat-tech-schema-live.ts

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

  console.log("--- heat_tech_families (Section 31) ---");
  const { data: families, error: familiesError } = await supabase
    .from("heat_tech_families")
    .select("family_key, label, aliases, enabled, sort_order");
  if (familiesError) {
    console.log(`✗ Table "heat_tech_families": ${familiesError.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "heat_tech_families" exists (${families?.length ?? 0} row(s), expected 4)`);
    const expectedKeys = ["titanium", "ceramic", "tourmaline", "ionic"];
    for (const familyKey of expectedKeys) {
      const found = families?.some(f => f.family_key === familyKey);
      console.log(found ? `  ✓ seeded: ${familyKey}` : `  ✗ MISSING: ${familyKey}`);
      if (!found) ok = false;
    }
  }

  console.log("\n--- branded_heat_tech_names (Section 32) ---");
  const { data: branded, error: brandedError } = await supabase
    .from("branded_heat_tech_names")
    .select("id")
    .limit(1);
  if (brandedError) {
    console.log(`✗ Table "branded_heat_tech_names": ${brandedError.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "branded_heat_tech_names" exists (admin-filled, starts empty — no seed rows expected)`);
  }

  console.log(ok ? "\nAll checks passed — heat_tech_families + branded_heat_tech_names are fully live." : "\nSome checks failed — run the updated supabase_schema.sql (Sections 31-32).");
  process.exit(ok ? 0 : 1);
}

main();
