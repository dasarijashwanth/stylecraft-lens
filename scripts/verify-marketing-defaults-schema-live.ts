// scripts/verify-marketing-defaults-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms
// marketing_defaults (Section 47) and the marketing_direction_generation_enabled
// feature flag (Section 46) are present and seeded after the user manually
// runs the updated supabase_schema.sql. Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-marketing-defaults-schema-live.ts

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

  const { data: defaults, error: defaultsErr } = await supabase.from("marketing_defaults").select("*").eq("id", 1).maybeSingle();
  if (defaultsErr) {
    console.log(`✗ Table "marketing_defaults": ${defaultsErr.message}`);
    ok = false;
  } else if (!defaults) {
    console.log(`✗ marketing_defaults has no seeded row (id=1)`);
    ok = false;
  } else {
    console.log(`✓ Table "marketing_defaults" exists — languages: "${defaults.languages}"`);
  }

  const { data: flag, error: flagErr } = await supabase.from("feature_flags").select("*").eq("flag_name", "marketing_direction_generation_enabled").maybeSingle();
  if (flagErr) {
    console.log(`✗ Table "feature_flags": ${flagErr.message}`);
    ok = false;
  } else if (!flag) {
    console.log(`✗ feature_flags has no row for "marketing_direction_generation_enabled"`);
    ok = false;
  } else {
    console.log(`✓ Feature flag "marketing_direction_generation_enabled" exists — enabled=${flag.enabled} (expected true)`);
    if (flag.enabled !== true) ok = false;
  }

  console.log(ok ? "\nAll checks passed — marketing defaults + feature flag are fully live." : "\nSome checks failed — see above (run the updated supabase_schema.sql).");
  process.exit(ok ? 0 : 1);
}

main();
