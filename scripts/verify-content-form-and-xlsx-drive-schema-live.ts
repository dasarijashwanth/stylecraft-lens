// scripts/verify-content-form-and-xlsx-drive-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// content_form_generation_enabled feature flag (Section 48) and the
// documents.xlsx_drive_url/xlsx_drive_file_id columns (Section 49) are
// present after the user manually runs the updated supabase_schema.sql.
// Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-content-form-and-xlsx-drive-schema-live.ts

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

  const { data: flag, error: flagErr } = await supabase.from("feature_flags").select("*").eq("flag_name", "content_form_generation_enabled").maybeSingle();
  if (flagErr) {
    console.log(`✗ Table "feature_flags": ${flagErr.message}`);
    ok = false;
  } else if (!flag) {
    console.log(`✗ feature_flags has no row for "content_form_generation_enabled"`);
    ok = false;
  } else {
    console.log(`✓ Feature flag "content_form_generation_enabled" exists — enabled=${flag.enabled} (expected true)`);
    if (flag.enabled !== true) ok = false;
  }

  const { error: colsErr } = await supabase.from("documents").select("xlsx_drive_url, xlsx_drive_file_id").limit(1);
  if (colsErr) {
    console.log(`✗ documents.xlsx_drive_url/xlsx_drive_file_id: ${colsErr.message}`);
    ok = false;
  } else {
    console.log(`✓ documents.xlsx_drive_url and documents.xlsx_drive_file_id columns exist`);
  }

  console.log(ok ? "\nAll checks passed — Content Form flag + GTM XLSX Drive columns are fully live." : "\nSome checks failed — see above (run the updated supabase_schema.sql).");
  process.exit(ok ? 0 : 1);
}

main();
