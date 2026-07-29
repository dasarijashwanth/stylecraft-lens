// scripts/verify-legacy-brand-domains-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// legacy_brands.official_domains column (Section 22 of supabase_schema.sql)
// exists after the user manually runs the updated SQL. Zero writes, zero
// AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-legacy-brand-domains-schema-live.ts

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

  const { error: colErr } = await supabase.from("legacy_brands").select("id, official_domains").limit(1);
  if (colErr) {
    console.log(`✗ Column "legacy_brands.official_domains": ${colErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Column "legacy_brands.official_domains" exists`);
  }

  const { data: wahl, error: wahlErr } = await supabase.from("legacy_brands").select("brand_name, official_domains").eq("brand_name", "Wahl").limit(1).maybeSingle();
  if (wahlErr) {
    console.log(`✗ Could not query a seeded brand row: ${wahlErr.message}`);
    ok = false;
  } else if (wahl) {
    console.log(`✓ Sample row "Wahl" — official_domains: ${JSON.stringify(wahl.official_domains)}`);
  } else {
    console.log(`(i) No "Wahl" row found — this is fine if the registry hasn't been seeded/migrated with domains yet.`);
  }

  console.log(ok ? "\nAll checks passed — legacy_brands.official_domains is live." : "\nSome checks failed — run the updated supabase_schema.sql (Section 22).");
  process.exit(ok ? 0 : 1);
}

main();
