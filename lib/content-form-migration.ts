// lib/content-form-migration.ts
// Pure planning logic for scripts/migrate-content-form.ts — split out so
// it's directly unit-testable (scripts/verify-content-form-migration.ts)
// without a real Supabase connection, same split as
// lib/gtm-schema-v3-migration.ts. Migrates Content Form's OLD flat-JSONB
// model (reports.content_form: {product_name, key_messages, target_audience,
// notes}, auto-populated by lib/db/reports.ts's buildReportSections for
// every analysis-derived report) onto its NEW field-granular model
// (documents/document_fields, doc_type="content_form",
// lib/content-form-field-schema.ts's 33-row schema).
//
// Every pre-existing project that already completed GTM generation (has a
// doc_type="gtm" document) gets a brand-new content_form document — all 33
// fields seeded with an honest "pending regeneration" placeholder (this
// migration never fabricates real copy), with the OLD blob's data preserved
// in specific fields' Notes rather than discarded. A project that already
// has a content_form document (migrated already, or generated for real by
// the new pipeline phase) is left untouched entirely — the idempotency
// boundary is at the document level (creating it is this migration's one
// irreversible action), simpler than gtm-schema-v3-migration.ts's per-field
// check since there's no old document_fields rows to delete here.
import { isRealMigratableAnswer } from "./gtm-schema-v2-migration";
import { CONTENT_FORM_SCHEMA } from "./content-form-field-schema";

export { isRealMigratableAnswer };

export interface OldContentFormBlob {
  product_name?: string | null;
  key_messages?: string[] | null;
  target_audience?: string | null;
  notes?: string | null;
}

export interface ContentFormNotesStash {
  fieldId: string;
  notesText: string;
}

export interface ContentFormMigrationPlan {
  // All 33 schema field ids — every one gets a placeholder row (this
  // migration always creates a full document, never a partial one).
  placeholderFieldIds: string[];
  // Old data preserved into specific fields' Notes, never overwriting the
  // placeholder answer itself.
  notesStashes: ContentFormNotesStash[];
}

export const CONTENT_FORM_MIGRATION_PLACEHOLDER = "Not determinable — pending regeneration";

export function planContentFormMigration(oldBlob: OldContentFormBlob | null): ContentFormMigrationPlan {
  const notesStashes: ContentFormNotesStash[] = [];

  const productNameReal = isRealMigratableAnswer(oldBlob?.product_name ?? null);
  const keyMessages = (oldBlob?.key_messages || []).filter(m => isRealMigratableAnswer(m));
  if (productNameReal || keyMessages.length > 0) {
    const parts: string[] = [];
    if (productNameReal) parts.push(`Product name: ${oldBlob!.product_name}`);
    if (keyMessages.length > 0) parts.push(`Key messages: ${keyMessages.join(" | ")}`);
    notesStashes.push({ fieldId: "romance_copy", notesText: `Migrated from previous Content Form. ${parts.join(". ")}` });
  }

  if (isRealMigratableAnswer(oldBlob?.target_audience ?? null)) {
    notesStashes.push({ fieldId: "suggested_use", notesText: `Migrated from previous Content Form — Target Audience: ${oldBlob!.target_audience}` });
  }

  if (isRealMigratableAnswer(oldBlob?.notes ?? null)) {
    notesStashes.push({ fieldId: "keywords", notesText: `Migrated from previous Content Form — Notes: ${oldBlob!.notes}` });
  }

  return {
    placeholderFieldIds: CONTENT_FORM_SCHEMA.map(f => f.id),
    notesStashes,
  };
}
