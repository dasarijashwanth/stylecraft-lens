// scripts/migrate-gtm-schema-v3.ts
// One-time migration for GTM Schema v3 (76-item field inventory, repeatable
// rows, select controls). Handles the 3 fields removed/split by v3
// (`upsell_cross_sell` -> `up_sell` + `cross_sell_1..5`, `top_6_features` ->
// `top_6_features_1..6`, `feature_icons` -> `feature_icons_1..6`) plus the
// v2-era single-blob `features_full_list` -> `features_full_list_1..10`,
// and backfills `trademark_symbol`'s new "Legal" owner default for existing
// rows still at the generic "Product Marketing" default.
//
// The actual decision logic lives in lib/gtm-schema-v3-migration.ts's
// planV3Migration — a pure function, unit-tested offline by
// scripts/verify-gtm-schema-v3.ts. This script is only the Supabase I/O
// around that decision (same split as scripts/migrate-gtm-schema-v2.ts).
//
// Run with: npx tsx scripts/migrate-gtm-schema-v3.ts              # dry run — prints the plan, writes nothing
//           npx tsx scripts/migrate-gtm-schema-v3.ts --confirm    # applies it for real
//
// Safe to re-run: a document with none of the 4 old field rows left (and no
// owner fix needed) is simply skipped.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { planV3Migration } from "../lib/gtm-schema-v3-migration";

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

// New group rows' section/question — matches lib/gtm-field-schema.ts's
// groupFields() output exactly, for the case a row doesn't exist yet.
const GROUP_FIELD_META: Record<string, { section: string; questionPrefix: string }> = {
  top_6_features: { section: "Tool Description", questionPrefix: "Top Feature" },
  feature_icons: { section: "Tool Description", questionPrefix: "Icon" },
  features_full_list: { section: "General", questionPrefix: "Feature" },
};

function groupIdFromFieldId(fieldId: string): string {
  return fieldId.replace(/_\d+$/, "");
}

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

    const plan = planV3Migration((fields || []).map((f: any) => ({ field_id: f.field_id, answer: f.answer, source: f.source, owner: f.owner })));
    if (plan.toDelete.length === 0 && !plan.trademarkOwnerFix) {
      untouchedDocs++;
      continue;
    }

    plannedActions.push(
      `Document ${doc.id} (project ${doc.project_id}): delete [${plan.toDelete.join(", ")}]` +
      (plan.groupSeeds.length > 0 ? `, seed [${plan.groupSeeds.map(s => s.fieldId).join(", ")}]` : "") +
      (plan.upSellNotesStep ? ", stash into up_sell Notes" : "") +
      (plan.trademarkOwnerFix ? ", backfill trademark_symbol owner -> Legal" : "")
    );

    if (!confirmed) continue;

    for (const seed of plan.groupSeeds) {
      const existing = byId.get(seed.fieldId);
      const meta = GROUP_FIELD_META[groupIdFromFieldId(seed.fieldId)];
      if (existing) {
        const { error: updErr } = await supabase.from("document_fields").update({ answer: seed.answer, source: seed.source }).eq("id", existing.id);
        if (updErr) throw updErr;
      } else {
        const index = seed.fieldId.match(/_(\d+)$/)?.[1] || "1";
        const { error: insErr } = await supabase.from("document_fields").insert({
          document_id: doc.id,
          field_id: seed.fieldId,
          section: meta.section,
          question: `${meta.questionPrefix} #${index}`,
          answer: seed.answer,
          ai_answer: null,
          source: seed.source,
          source_detail: {},
          flagged: false,
          owner: "Product Marketing",
          notes: null,
          updated_at: new Date().toISOString(),
        });
        if (insErr) throw insErr;
      }
    }

    if (plan.upSellNotesStep) {
      const existingUpSell = byId.get("up_sell");
      const notesText = plan.upSellNotesStep.notesText;
      if (existingUpSell) {
        const mergedNotes = existingUpSell.notes ? `${existingUpSell.notes} | ${notesText}` : notesText;
        const { error: updErr } = await supabase.from("document_fields").update({ notes: mergedNotes }).eq("id", existingUpSell.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from("document_fields").insert({
          document_id: doc.id,
          field_id: "up_sell",
          section: "General",
          question: "Up-sell (Sales play opportunity)",
          answer: "Not found — checked 4 sources",
          ai_answer: null,
          source: "none",
          source_detail: {},
          flagged: false,
          owner: "Product Marketing",
          notes: notesText,
          updated_at: new Date().toISOString(),
        });
        if (insErr) throw insErr;
      }
    }

    if (plan.trademarkOwnerFix) {
      const trademarkRow = byId.get("trademark_symbol");
      if (trademarkRow) {
        const { error: updErr } = await supabase.from("document_fields").update({ owner: "Legal" }).eq("id", trademarkRow.id);
        if (updErr) throw updErr;
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
