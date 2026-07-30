// scripts/verify-motor-family-fields-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms
// projects.motor_family / projects.motor_branded_name (Section 26 of
// supabase_schema.sql) exist after the user manually runs the updated SQL.
// Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-motor-family-fields-schema-live.ts

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

  const { error } = await supabase.from("projects").select("motor_family, motor_branded_name, motor_tech").limit(1);
  if (error) {
    console.log(`✗ projects.motor_family/motor_branded_name: ${error.message}`);
    ok = false;
  } else {
    console.log(`✓ projects.motor_family and projects.motor_branded_name exist alongside the legacy motor_tech column`);
  }

  console.log(ok ? "\nAll checks passed — canonical motor fields are live on projects." : "\nSome checks failed — run the updated supabase_schema.sql (Section 26).");
  process.exit(ok ? 0 : 1);
}

main();
