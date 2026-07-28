// scripts/verify-feature-flags-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// feature_flags table (seeded with tds_enabled) and faqs.feature column
// (Section 20 of supabase_schema.sql) exist after the user manually runs
// the updated SQL. Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-feature-flags-schema-live.ts

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

  const { data: flag, error: flagErr } = await supabase.from("feature_flags").select("*").eq("flag_name", "tds_enabled").maybeSingle();
  if (flagErr) {
    console.log(`✗ Table "feature_flags": ${flagErr.message}`);
    ok = false;
  } else if (!flag) {
    console.log(`✗ feature_flags has no seeded "tds_enabled" row`);
    ok = false;
  } else {
    console.log(`✓ Table "feature_flags" exists — tds_enabled = ${flag.enabled}`);
  }

  const { error: faqErr } = await supabase.from("faqs").select("feature").limit(1);
  if (faqErr) {
    console.log(`✗ Column "faqs.feature": ${faqErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Column "faqs.feature" exists`);
  }

  const { data: tdsFaqs, error: tdsFaqErr } = await supabase.from("faqs").select("id, question").eq("feature", "tds");
  if (tdsFaqErr) {
    console.log(`✗ Could not query feature='tds' FAQ rows: ${tdsFaqErr.message}`);
    ok = false;
  } else {
    console.log(`✓ ${tdsFaqs?.length ?? 0} FAQ row(s) tagged feature='tds' (expected 2)`);
    if ((tdsFaqs?.length ?? 0) !== 2) ok = false;
  }

  console.log(ok ? "\nAll checks passed — TDS feature flag is fully live." : "\nSome checks failed — run the updated supabase_schema.sql (Section 20).");
  process.exit(ok ? 0 : 1);
}

main();
