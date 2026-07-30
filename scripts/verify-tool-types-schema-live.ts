// scripts/verify-tool-types-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// tool_types table (Section 28 of supabase_schema.sql) exists and is seeded
// with the 9 built-in types after the user manually runs the updated SQL.
// Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-tool-types-schema-live.ts

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

  const { data, error } = await supabase.from("tool_types").select("type_key, label, family, custom, enabled");
  if (error) {
    console.log(`✗ Table "tool_types": ${error.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "tool_types" exists (${data?.length ?? 0} row(s), expected 9)`);
    const expectedKeys = ["trimmer", "shaver", "dryer", "flat_iron", "curling_iron", "hot_brush", "clipper", "other_styling", "combo"];
    for (const key of expectedKeys) {
      const found = data?.some(t => t.type_key === key);
      console.log(found ? `  ✓ seeded: ${key}` : `  ✗ MISSING: ${key}`);
      if (!found) ok = false;
    }
    const comboRow = data?.find(t => t.type_key === "combo");
    if (comboRow && comboRow.family !== null) {
      console.log(`  ✗ "combo" should have a NULL family (valid under either industry), got ${comboRow.family}`);
      ok = false;
    }
  }

  console.log(ok ? "\nAll checks passed — tool_types is fully live." : "\nSome checks failed — run the updated supabase_schema.sql (Section 28).");
  process.exit(ok ? 0 : 1);
}

main();
