// scripts/migrate-content-form.ts
// One-time migration from Content Form's OLD flat-JSONB model
// (reports.content_form: {product_name, key_messages, target_audience,
// notes}) onto its NEW field-granular model (documents/document_fields,
// doc_type="content_form"). The actual decision logic lives in
// lib/content-form-migration.ts's planContentFormMigration — a pure
// function, unit-tested offline by scripts/verify-content-form-migration.ts.
// This script is only the Supabase I/O around that decision (same split as
// scripts/migrate-gtm-schema-v3.ts).
//
// Every project that already has a doc_type="gtm" document (i.e. already
// completed real project setup) but has NO doc_type="content_form" document
// yet gets one created here, with all 33 schema fields seeded with an
// honest "pending regeneration" placeholder and the project's most recent
// report's OLD content_form blob (if any) preserved into specific fields'
// Notes. A project that already has a content_form document — migrated
// already, or generated for real by the pipeline's own new "content_form"
// phase — is left completely untouched.
//
// Run with: npx tsx scripts/migrate-content-form.ts              # dry run — prints the plan, writes nothing
//           npx tsx scripts/migrate-content-form.ts --confirm    # applies it for real
//
// Safe to re-run: a project that already has a content_form document is
// simply skipped.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { planContentFormMigration, CONTENT_FORM_MIGRATION_PLACEHOLDER } from "../lib/content-form-migration";
import { CONTENT_FORM_SCHEMA } from "../lib/content-form-field-schema";

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

const SCHEMA_BY_ID = new Map(CONTENT_FORM_SCHEMA.map(f => [f.id, f]));

async function main() {
  const { data: gtmDocs, error } = await supabase.from("documents").select("id, project_id").eq("doc_type", "gtm");
  if (error) throw error;
  if (!gtmDocs || gtmDocs.length === 0) {
    console.log("No GTM documents found — nothing to migrate.");
    return;
  }

  const { data: existingContentFormDocs, error: cfErr } = await supabase.from("documents").select("project_id").eq("doc_type", "content_form");
  if (cfErr) throw cfErr;
  const alreadyMigrated = new Set((existingContentFormDocs || []).map((d: any) => d.project_id));

  const confirmed = process.argv.includes("--confirm");
  console.log(`${gtmDocs.length} GTM document(s) found, ${alreadyMigrated.size} project(s) already have a content_form document.\n`);

  const plannedActions: string[] = [];
  let migratedCount = 0;
  let skippedCount = 0;

  for (const doc of gtmDocs) {
    if (alreadyMigrated.has(doc.project_id)) {
      skippedCount++;
      continue;
    }

    const { data: reports, error: rErr } = await supabase
      .from("reports")
      .select("content_form")
      .eq("project_id", doc.project_id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (rErr) throw rErr;
    const oldBlob = reports?.[0]?.content_form ?? null;

    const plan = planContentFormMigration(oldBlob);
    plannedActions.push(
      `Project ${doc.project_id}: create content_form document with ${plan.placeholderFieldIds.length} fields` +
      (plan.notesStashes.length > 0 ? `, stash Notes into [${plan.notesStashes.map(s => s.fieldId).join(", ")}]` : "")
    );

    if (!confirmed) continue;

    const { data: newDoc, error: insDocErr } = await supabase
      .from("documents")
      .insert({ project_id: doc.project_id, doc_type: "content_form", status: "draft" })
      .select()
      .single();
    if (insDocErr) throw insDocErr;

    const notesByFieldId = new Map(plan.notesStashes.map(s => [s.fieldId, s.notesText]));
    const now = new Date().toISOString();
    const fieldRows = plan.placeholderFieldIds.map(fieldId => {
      const schemaField = SCHEMA_BY_ID.get(fieldId)!;
      return {
        document_id: newDoc.id,
        field_id: fieldId,
        section: schemaField.section,
        question: schemaField.question,
        answer: CONTENT_FORM_MIGRATION_PLACEHOLDER,
        ai_answer: null,
        source: "none",
        source_detail: {},
        flagged: false,
        owner: schemaField.owner,
        notes: notesByFieldId.get(fieldId) ?? null,
        updated_at: now,
      };
    });

    const { error: insFieldsErr } = await supabase.from("document_fields").insert(fieldRows);
    if (insFieldsErr) throw insFieldsErr;

    migratedCount++;
  }

  console.log("Planned actions:");
  if (plannedActions.length === 0) console.log("  (none — every project either has no GTM document yet, or already has a content_form document)");
  else plannedActions.forEach(a => console.log(`  ${a}`));

  if (!confirmed) {
    console.log(`\nDry run only — ${plannedActions.length} project(s) need migration, ${skippedCount} already have a content_form document. Re-run with --confirm to apply.`);
    return;
  }
  console.log(`\nDone. ${migratedCount} project(s) migrated, ${skippedCount} already had a content_form document.`);
}

main().catch(err => {
  console.error("Migration script failed:", err);
  process.exit(1);
});
