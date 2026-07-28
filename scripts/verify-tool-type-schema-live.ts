// scripts/verify-tool-type-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// projects.tool_type column (Section 19 of supabase_schema.sql) exists
// after the user manually runs the updated SQL. Zero writes, zero AI/
// Rainforest calls — just a SELECT.
//
// Run with: npx tsx scripts/verify-tool-type-schema-live.ts

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

  const { error } = await supabase.from("projects").select("tool_type").limit(1);
  if (error) {
    console.log(`✗ Column "projects.tool_type": ${error.message}`);
    ok = false;
  } else {
    console.log(`✓ Column "projects.tool_type" exists`);
  }

  console.log(ok ? "\nAll checks passed — tool_type column is live." : "\nSome checks failed — run the updated supabase_schema.sql (Section 19).");
  process.exit(ok ? 0 : 1);
}

main();
