// scripts/verify-competitor-matching-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms
// motor_families/competitor_matching_config are present and seeded after
// the user manually runs the updated supabase_schema.sql. Zero writes,
// zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-competitor-matching-schema-live.ts

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

  const { data: families, error: famErr } = await supabase.from("motor_families").select("family_key, modifier");
  if (famErr) {
    console.log(`✗ Table "motor_families": ${famErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "motor_families" exists (${families?.length ?? 0} row(s), expected 9)`);
    // Post Section-25 migration: 7 active canonical families + 2 disabled
    // legacy rows kept for history (linear folded into pivot, brushless_digital
    // folded into brushless) — see supabase_schema.sql's Section 25 comment.
    const expectedKeys = ["rotary", "magnetic", "vector", "pivot", "ac_motor", "dc_motor", "brushless", "linear", "brushless_digital"];
    for (const key of expectedKeys) {
      const found = families?.some(f => f.family_key === key);
      console.log(found ? `  ✓ seeded: ${key}` : `  ✗ MISSING: ${key}`);
      if (!found) ok = false;
    }
    const brushlessRow = families?.find(f => f.family_key === "brushless");
    if (brushlessRow && brushlessRow.modifier === true) {
      console.log(`  ✗ "brushless" is still modifier:true — run the updated Section 25 SQL`);
      ok = false;
    } else if (brushlessRow) {
      console.log(`  ✓ "brushless" is a standalone family (modifier:false)`);
    }
  }

  const { data: config, error: configErr } = await supabase.from("competitor_matching_config").select("*").eq("id", 1).maybeSingle();
  if (configErr) {
    console.log(`✗ Table "competitor_matching_config": ${configErr.message}`);
    ok = false;
  } else if (!config) {
    console.log(`✗ competitor_matching_config has no seeded row (id=1)`);
    ok = false;
  } else {
    console.log(`✓ Table "competitor_matching_config" exists — weights: motor=${config.motor_weight}, price=${config.price_weight}, feature=${config.feature_weight}`);
  }

  console.log(ok ? "\nAll checks passed — competitor matching config is fully live." : "\nSome checks failed — see above (run the updated supabase_schema.sql).");
  process.exit(ok ? 0 : 1);
}

main();
