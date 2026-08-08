// scripts/verify-source-fill-schema-live.ts
// Read-only check against the REAL configured Supabase project — confirms
// supabase_schema.sql's Section 53 additions actually exist after being run
// by hand (extracted_facts.fact_type/confidence, uploaded_source_docs.
// locations, the document_fill_state table). Loads .env.local directly,
// uses SUPABASE_SERVICE_ROLE_KEY, bypasses this repo's @/ module system —
// same convention as every other *-schema-live.ts script.
// Run with: npx tsx scripts/verify-source-fill-schema-live.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import path from "path";

const envPath = path.join(__dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  console.log("Loaded .env.local");
}

let passes = 0;
let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) { passes++; console.log(`✓ ${message}`); }
  else { failures++; console.error(`✗ ${message}`); }
}

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot run a live check.");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log("\n--- extracted_facts.fact_type / .confidence (Section 53) ---");
  const { data: factsRow, error: factsErr } = await supabase.from("extracted_facts").select("fact_type, confidence").limit(1).maybeSingle();
  assert(!factsErr, `extracted_facts.fact_type/confidence are queryable${factsErr ? ` (error: ${factsErr.message})` : ""}`);
  if (factsRow) {
    assert(typeof factsRow.fact_type === "string", `an existing row's fact_type defaults to a string (got ${JSON.stringify(factsRow.fact_type)})`);
    assert(typeof factsRow.confidence === "string", `an existing row's confidence defaults to a string (got ${JSON.stringify(factsRow.confidence)})`);
  } else {
    console.log("  (no existing extracted_facts rows to sample defaults from — column presence alone confirmed above)");
  }

  console.log("\n--- uploaded_source_docs.locations (Section 53) ---");
  const { data: docRow, error: docErr } = await supabase.from("uploaded_source_docs").select("locations").limit(1).maybeSingle();
  assert(!docErr, `uploaded_source_docs.locations is queryable${docErr ? ` (error: ${docErr.message})` : ""}`);
  if (docRow) {
    assert(Array.isArray(docRow.locations), `an existing row's locations defaults to an array (got ${JSON.stringify(docRow.locations)})`);
  }

  console.log("\n--- document_fill_state table (Section 53) ---");
  const { error: fillStateErr } = await supabase.from("document_fill_state").select("project_id, status, steps, current_step_index, results").limit(1);
  assert(!fillStateErr, `document_fill_state is queryable${fillStateErr ? ` (error: ${fillStateErr.message})` : ""}`);

  console.log(`\n${passes} passed, ${failures} failed`);
  console.log(failures > 0 ? "\nNot all checks passed — see above." : "\nAll checks passed — the source-fill schema is fully live.");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
