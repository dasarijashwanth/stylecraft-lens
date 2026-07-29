// scripts/verify-buyer-sentiment-news-flags-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// buyer_sentiment_enabled and news_updates_enabled rows (Section 23 of
// supabase_schema.sql) exist in the existing feature_flags table after the
// user manually runs the updated SQL. Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-buyer-sentiment-news-flags-schema-live.ts

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

  for (const flagName of ["buyer_sentiment_enabled", "news_updates_enabled"]) {
    const { data, error } = await supabase.from("feature_flags").select("flag_name, enabled").eq("flag_name", flagName).maybeSingle();
    if (error) {
      console.log(`✗ Row "${flagName}": ${error.message}`);
      ok = false;
    } else if (!data) {
      console.log(`✗ Row "${flagName}": not found — run Section 23 of supabase_schema.sql`);
      ok = false;
    } else {
      console.log(`✓ Row "${flagName}" exists (enabled=${data.enabled})`);
    }
  }

  console.log(ok ? "\nAll checks passed — both feature flag rows are live." : "\nSome checks failed — run the updated supabase_schema.sql (Section 23).");
  process.exit(ok ? 0 : 1);
}

main();
