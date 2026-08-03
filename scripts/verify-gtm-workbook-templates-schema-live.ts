// scripts/verify-gtm-workbook-templates-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// gtm_workbook_templates/catalog_products.upc/brand_voice_guides/
// documents.voice_guide_* schema and the gtm-workbook-templates Storage
// bucket exist after the user manually ran supabase_schema.sql Sections
// 40-43. Zero writes, zero AI/Rainforest calls — just SELECT/list.
//
// Run with: npx tsx scripts/verify-gtm-workbook-templates-schema-live.ts

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

  for (const table of ["gtm_workbook_templates", "brand_voice_guides"]) {
    const { error, count } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) {
      console.log(`✗ Table "${table}": ${error.message}`);
      ok = false;
    } else {
      console.log(`✓ Table "${table}" exists (${count ?? 0} row(s))`);
    }
  }

  const { error: upcError } = await supabase.from("catalog_products").select("upc").limit(1);
  if (upcError) {
    console.log(`✗ catalog_products.upc column: ${upcError.message}`);
    ok = false;
  } else {
    console.log(`✓ catalog_products.upc column exists`);
  }

  const { error: voiceColError } = await supabase.from("documents").select("voice_guide_id, voice_guide_version").limit(1);
  if (voiceColError) {
    console.log(`✗ documents.voice_guide_id/voice_guide_version columns: ${voiceColError.message}`);
    ok = false;
  } else {
    console.log(`✓ documents.voice_guide_id/voice_guide_version columns exist`);
  }

  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    console.log(`✗ Could not list Storage buckets: ${bucketErr.message}`);
    ok = false;
  } else {
    const found = buckets?.some(b => b.name === "gtm-workbook-templates");
    console.log(found ? `✓ Storage bucket "gtm-workbook-templates" exists` : `✗ Storage bucket "gtm-workbook-templates" NOT found`);
    if (!found) ok = false;
    console.log(`  (all buckets found: ${buckets?.map(b => b.name).join(", ") || "none"})`);
  }

  console.log(ok ? "\nAll checks passed." : "\nSome checks failed — see above.");
  process.exit(ok ? 0 : 1);
}

main();
