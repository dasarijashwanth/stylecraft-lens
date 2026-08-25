// scripts/verify-predecessor-ref-schema-live.ts
// Read-only — confirms projects.predecessor_ref exists in the live
// Supabase project after applying supabase_schema.sql Section 59 by hand.
// Run with: npx tsx scripts/verify-predecessor-ref-schema-live.ts
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
readFileSync(envPath, "utf-8").split("\n").forEach(line => {
  const t = line.trim();
  if (!t || t.startsWith("#")) return;
  const i = t.indexOf("=");
  if (i === -1) return;
  const k = t.substring(0, i).trim();
  let v = t.substring(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k] = v;
});

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);
  const { data, error } = await supabase.from("projects").select("id, predecessor_ref").limit(1);
  if (error) {
    console.log("FAIL — projects.predecessor_ref is NOT reachable yet:", error.message);
    console.log("\nRun this in the Supabase SQL editor:\n");
    console.log("ALTER TABLE projects ADD COLUMN IF NOT EXISTS predecessor_ref VARCHAR(500);");
    process.exit(1);
  }
  console.log("PASS — projects.predecessor_ref is reachable.", data);
}
main().catch(e => { console.error(e); process.exit(1); });
