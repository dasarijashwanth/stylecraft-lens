// scripts/enable-all-feature-flags.ts
// One-off — sets every known feature flag to enabled=true against the live
// Supabase project, per an explicit "turn everything on" request. Prints
// before/after state. Three of these flags were deliberately disabled for
// real, documented reasons (see lib/db/feature-flags.ts's own comments):
// buyer_sentiment_enabled/news_updates_enabled were disabled because their
// whole point was to REMOVE those sections from the product; deck_generation_enabled
// was disabled because deck generation was repeatedly stalling/timing out
// the project auto-pipeline. Flipping them back on is a real, if reversible,
// product/reliability decision, not a no-op — flagged to the operator
// running this script.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

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

const KNOWN_FLAGS = [
  "tds_enabled",
  "buyer_sentiment_enabled",
  "news_updates_enabled",
  "deck_generation_enabled",
  "marketing_direction_generation_enabled",
  "content_form_generation_enabled",
];

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log("=== Before ===");
  const { data: before, error: beforeErr } = await supabase.from("feature_flags").select("*").order("flag_name");
  if (beforeErr) throw beforeErr;
  for (const flag of KNOWN_FLAGS) {
    const row = (before || []).find(r => r.flag_name === flag);
    console.log(`  ${flag}: ${row ? row.enabled : "(no row — would fall back to a default)"}`);
  }

  console.log("\n=== Enabling all known flags ===");
  for (const flag of KNOWN_FLAGS) {
    const { error } = await supabase.from("feature_flags").upsert({ flag_name: flag, enabled: true, updated_at: new Date().toISOString() }, { onConflict: "flag_name" });
    if (error) throw error;
    console.log(`  ${flag} -> true`);
  }

  console.log("\n=== After ===");
  const { data: after, error: afterErr } = await supabase.from("feature_flags").select("*").order("flag_name");
  if (afterErr) throw afterErr;
  for (const row of after || []) console.log(`  ${row.flag_name}: ${row.enabled}`);
}

main();
