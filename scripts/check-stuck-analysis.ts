// scripts/check-stuck-analysis.ts
// One-off, read-only diagnostic for a single "analysis taking too long"
// report — finds the most recent analysis matching a product name (stored
// in context.productName, not a real column) and prints its phase/status/
// timing/pending-question state. Zero writes.
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

const SEARCH_TERM = "saber";

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, phase, error_message, duration_ms, created_at, completed_at, context, phase0_result, phase1_result, phase2_result, pending_question")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;

  const matches = (data || []).filter(row => {
    const name = (row.context?.productName || row.phase0_result?.productName || "").toLowerCase();
    return name.includes(SEARCH_TERM.toLowerCase());
  });

  if (matches.length === 0) {
    console.log(`No analyses among the 30 most recent match "${SEARCH_TERM}" — showing the 5 most recent analyses of any product instead:`);
    matches.push(...(data || []).slice(0, 5));
  }

  for (const row of matches) {
    console.log("\n=================================");
    console.log("id:", row.id);
    console.log("productName:", row.context?.productName || row.phase0_result?.productName);
    console.log("status:", row.status, "| phase:", row.phase);
    console.log("created_at:", row.created_at, "| completed_at:", row.completed_at);
    console.log("duration_ms:", row.duration_ms);
    console.log("error_message:", row.error_message);
    console.log("pending_question:", JSON.stringify(row.pending_question));
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    console.log(`age: ${(ageMs / 1000).toFixed(0)}s (${(ageMs / 60000).toFixed(1)} min)`);
    const p1 = row.phase1_result || {};
    const p2 = row.phase2_result || {};
    console.log("phase1_result:", Object.keys(p1).length ? `competitors=${(p1.competitors || []).length} __phase1Fill=${JSON.stringify(p1.__phase1Fill)}` : "(empty)");
    console.log("phase2_result:", Object.keys(p2).length ? `competitors=${(p2.competitors || []).length} __phase2Fill=${JSON.stringify(p2.__phase2Fill)} __phase2Stage=${p2.__phase2Stage}` : "(empty)");
    console.log("context.motorTech:", row.context?.motorTech, "| pricePoint:", row.context?.pricePoint);
  }
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
