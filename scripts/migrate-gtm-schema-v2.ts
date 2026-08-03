// scripts/migrate-gtm-schema-v2.ts
// One-time migration for GTM Schema v2 (6 field changes to the Product
// Knowledge sheet, lib/gtm-field-schema.ts). Renamed fields (Good Better
// Best -> Good Better Best (Lineup)) need NO database change at all — the
// UI/CSV/PDF all render the LIVE schema's question text, never the stored
// document_fields.question column. What DOES need migrating: the 3 REMOVED
// fields (`performance`, `comps`, `comps_buying_guide`) had real per-project
// answers that would otherwise just vanish — this script stashes any real
// answer into the replacing field's Notes before deleting the old row.
// The 2 new fields (`good_better_best_performance`,
// `comparison_chart_web_only`) get a placeholder row so they show up in the
// UI immediately; the project's next natural GTM regenerate (or a manual
// per-field Regenerate click) fills them for real via the new derivers in
// lib/gtm-tier6-inference.ts / lib/gtm-features-and-tip.ts.
//
// The actual decision logic (what to delete, what to stash) lives in
// lib/gtm-schema-v2-migration.ts's planFieldMigration — a pure function,
// unit-tested offline by scripts/verify-gtm-schema-v2.ts. This script is
// only the Supabase I/O around that decision (same split as
// scripts/backfill-gtm.ts's engine-vs-script separation).
//
// Run with: npx tsx scripts/migrate-gtm-schema-v2.ts              # dry run — prints the plan, writes nothing
//           npx tsx scripts/migrate-gtm-schema-v2.ts --confirm    # applies it for real
//
// Safe to re-run: a document with none of the 3 old field rows left is
// simply skipped (checked fresh each run, not cached).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { planFieldMigration } from "../lib/gtm-schema-v2-migration";

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
  console.log("Successfully loaded environment variables from .env.local");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, "");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env or .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NEW_FIELD_META: Record<string, { section: string; question: string }> = {
  good_better_best_performance: { section: "General", question: "Good Better Best (Performance)" },
  comparison_chart_web_only: { section: "General", question: "Comparison Chart WEB ONLY" },
};

async function main() {
  const { data: gtmDocs, error } = await supabase.from("documents").select("id, project_id").eq("doc_type", "gtm");
  if (error) throw error;
  if (!gtmDocs || gtmDocs.length === 0) {
    console.log("No GTM documents found.");
    return;
  }

  const confirmed = process.argv.includes("--confirm");
  console.log(`${gtmDocs.length} GTM document(s) found.\n`);

  const plannedActions: string[] = [];
  let migratedDocs = 0;
  let untouchedDocs = 0;

  for (const doc of gtmDocs) {
    const { data: fields, error: fErr } = await supabase.from("document_fields").select("*").eq("document_id", doc.id);
    if (fErr) throw fErr;
    const byId = new Map((fields || []).map((f: any) => [f.field_id, f]));

    const plan = planFieldMigration((fields || []).map((f: any) => ({ field_id: f.field_id, answer: f.answer })));
    if (plan.toDelete.length === 0) {
      untouchedDocs++;
      continue;
    }

    plannedActions.push(
      `Document ${doc.id} (project ${doc.project_id}): delete [${plan.toDelete.join(", ")}]` +
      (plan.notesSteps.length > 0 ? `, stash real values into Notes on [${plan.notesSteps.map(s => s.newId).join(", ")}]` : ", no real values to stash")
    );

    if (!confirmed) continue;

    for (const step of plan.notesSteps) {
      const existingNew = byId.get(step.newId);
      if (existingNew) {
        const mergedNotes = existingNew.notes ? `${existingNew.notes} | ${step.notesText}` : step.notesText;
        const { error: updErr } = await supabase.from("document_fields").update({ notes: mergedNotes }).eq("id", existingNew.id);
        if (updErr) throw updErr;
      } else {
        const meta = NEW_FIELD_META[step.newId];
        const { error: insErr } = await supabase.from("document_fields").insert({
          document_id: doc.id,
          field_id: step.newId,
          section: meta.section,
          question: meta.question,
          answer: "Not determinable — pending regeneration",
          ai_answer: null,
          source: "none",
          source_detail: {},
          flagged: false,
          owner: "Product Marketing",
          notes: step.notesText,
          updated_at: new Date().toISOString(),
        });
        if (insErr) throw insErr;
      }
    }

    for (const oldId of plan.toDelete) {
      const { error: delErr } = await supabase.from("document_fields").delete().eq("document_id", doc.id).eq("field_id", oldId);
      if (delErr) throw delErr;
    }

    migratedDocs++;
  }

  console.log("Planned actions:");
  if (plannedActions.length === 0) console.log("  (none — every GTM document is already clean)");
  else plannedActions.forEach(a => console.log(`  ${a}`));

  if (!confirmed) {
    console.log(`\nDry run only — ${plannedActions.length} document(s) need migration, ${untouchedDocs} already clean. Re-run with --confirm to apply.`);
    return;
  }
  console.log(`\nDone. ${migratedDocs} document(s) migrated, ${untouchedDocs} already clean.`);
}

main().catch(err => {
  console.error("Migration script failed:", err);
  process.exit(1);
});
