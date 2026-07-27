// scripts/wipe-projects-and-analyses.ts
// ONE-TIME reset: backs up then permanently deletes every project and
// analysis (and everything that hangs off them) so the app starts fresh
// for the newly-created team accounts.
//
// Backs up first (full row dump to scratch/, gitignored) — deletion is
// irreversible otherwise. Deletes, in dependency order:
//   reports (project_id/analysis_id are ON DELETE SET NULL, not cascaded —
//     deleted explicitly so none survive as orphans)
//   project_artwork (not declared with a cascade FK in supabase_schema.sql
//     at all — deleted explicitly, defensively)
//   analyses (cascades: analysis_competitors, analysis_tasks)
//   projects (cascades: documents -> document_fields -> document_field_history,
//     product_snapshots, project_generation_state, project_outputs, project_decks)
//
// Deliberately untouched: competitors (a separate tracked/reference list,
// not mentioned), and all admin config (faqs, legacy_brands, motor_families,
// competitor_matching_config, deck_templates, support_messages).
//
// Run with: npx tsx scripts/wipe-projects-and-analyses.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
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

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(url, key);

const BACKUP_TABLES = [
  "projects",
  "analyses",
  "reports",
  "documents",
  "document_fields",
  "document_field_history",
  "product_snapshots",
  "project_outputs",
  "project_decks",
  "project_artwork",
  "analysis_competitors",
  "analysis_tasks",
  "project_generation_state",
];

async function fetchAll(table: string): Promise<any[]> {
  const { data, error } = await supabase.from(table).select("*");
  if (error) {
    console.warn(`  (skipping backup of "${table}": ${error.message})`);
    return [];
  }
  return data || [];
}

async function deleteAll(table: string): Promise<number> {
  const { error, count } = await supabase.from(table).delete({ count: "exact" }).gte("created_at", "1900-01-01T00:00:00.000Z");
  if (error) {
    console.warn(`  (could not delete from "${table}": ${error.message})`);
    return 0;
  }
  return count ?? 0;
}

async function main() {
  console.log("Backing up all rows before deletion…");
  const backup: Record<string, any[]> = {};
  for (const table of BACKUP_TABLES) {
    backup[table] = await fetchAll(table);
    console.log(`  ${table}: ${backup[table].length} row(s)`);
  }

  mkdirSync(resolve(process.cwd(), "scratch"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(process.cwd(), "scratch", `pre-wipe-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written to ${backupPath}\n`);

  console.log("Deleting (dependency order)…");
  const reportsDeleted = await deleteAll("reports");
  console.log(`  reports: ${reportsDeleted} deleted`);

  // project_artwork has no declared FK/cascade in supabase_schema.sql — it
  // may not even exist as a real table in every environment; created_at
  // may not exist on it either, so fall back to an id-based filter.
  {
    const { error, count } = await supabase.from("project_artwork").delete({ count: "exact" }).not("id", "is", null);
    if (error) console.warn(`  (could not delete from "project_artwork": ${error.message})`);
    else console.log(`  project_artwork: ${count ?? 0} deleted`);
  }

  const analysesDeleted = await deleteAll("analyses");
  console.log(`  analyses: ${analysesDeleted} deleted (cascades analysis_competitors, analysis_tasks)`);

  const projectsDeleted = await deleteAll("projects");
  console.log(`  projects: ${projectsDeleted} deleted (cascades documents, product_snapshots, project_generation_state, project_outputs, project_decks)`);

  console.log("\nDone. Everything else (competitors, FAQs, legacy brands, motor families, deck templates, support messages) was left untouched.");
}

main().catch(err => {
  console.error("wipe-projects-and-analyses script failed:", err.message || err);
  process.exit(1);
});
