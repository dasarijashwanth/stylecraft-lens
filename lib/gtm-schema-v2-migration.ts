// lib/gtm-schema-v2-migration.ts
// Pure planning logic for scripts/migrate-gtm-schema-v2.ts, split out so it's
// directly unit-testable (scripts/verify-gtm-schema-v2.ts) without needing a
// real Supabase connection — the migration script itself owns all the actual
// I/O (reading/writing document_fields), this module only decides WHAT to do
// given a document's current field rows.
export interface OldGtmFieldRow {
  field_id: string;
  answer: string | null;
}

export interface FieldMigrationStep {
  newId: string;
  notesText: string;
}

export interface FieldMigrationPlan {
  // field ids to delete from this document (may be empty if the document
  // was already migrated or never had any of the 3 old fields).
  toDelete: string[];
  // one entry per NEW field id that needs a real value stashed into its
  // Notes — comps AND comps_buying_guide both target
  // comparison_chart_web_only, so their notes are pre-joined here into one
  // step per new id, never two separate writes to the same field's notes.
  notesSteps: FieldMigrationStep[];
}

const OLD_TO_NEW: { oldId: string; newId: string; label: string }[] = [
  { oldId: "performance", newId: "good_better_best_performance", label: "Previous value" },
  { oldId: "comps", newId: "comparison_chart_web_only", label: "Previous COMPS value" },
  { oldId: "comps_buying_guide", newId: "comparison_chart_web_only", label: "Previous Comps for Buying Guide value" },
];

// Mirrors lib/field-answer-state.ts's isRealAnswer without importing it —
// this module (and the script that uses it) deliberately stays import-free
// of the rest of lib/db, per scripts/backfill-gtm.ts's own precedent of a
// standalone Supabase-only migration tool.
export function isRealMigratableAnswer(answer: string | null | undefined): boolean {
  if (!answer) return false;
  const upper = answer.toUpperCase();
  if (upper === "N/A" || upper === "TBD") return false;
  if (answer.startsWith("Not determinable") || answer === "Awaiting internal input") return false;
  return true;
}

export function planFieldMigration(fields: OldGtmFieldRow[]): FieldMigrationPlan {
  const byId = new Map(fields.map(f => [f.field_id, f]));
  const oldRowsPresent = OLD_TO_NEW.filter(m => byId.has(m.oldId));
  if (oldRowsPresent.length === 0) return { toDelete: [], notesSteps: [] };

  const notesByNewId = new Map<string, string[]>();
  for (const m of oldRowsPresent) {
    const oldRow = byId.get(m.oldId)!;
    if (isRealMigratableAnswer(oldRow.answer)) {
      const list = notesByNewId.get(m.newId) || [];
      list.push(`${m.label}: ${oldRow.answer}`);
      notesByNewId.set(m.newId, list);
    }
  }

  return {
    toDelete: oldRowsPresent.map(m => m.oldId),
    notesSteps: Array.from(notesByNewId.entries()).map(([newId, notesList]) => ({ newId, notesText: notesList.join(" | ") })),
  };
}
