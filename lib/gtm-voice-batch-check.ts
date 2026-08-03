// lib/gtm-voice-batch-check.ts
// Brand Voice Guide, Part 5 — admin "Voice check" batch action. Re-lints an
// ALREADY-generated GTM document's written fields against the current
// brand voice guide, flagging (never auto-rewriting) whatever violates.
// Skips any field a human has edited since generation — same detection the
// CSV export route already uses (answer diverged from ai_answer) — so a
// hand-edited field is never touched by this pass. Scoped to GTM documents
// only: Sales Kit's output lives in one undifferentiated project_outputs
// JSONB blob with no per-field human-edit tracking, so it's a natural but
// explicitly out-of-scope extension point for this pass.
import { GTM_FIELD_SCHEMA } from "./gtm-field-schema";
import { getDocumentByProject, getDocumentFields, updateDocumentField, DocumentFieldRow } from "./db/documents";
import { getToneForGtmField } from "./brand-voice";
import { findDeterministicViolations } from "./brand-voice-lint";

export interface VoiceCheckSummary {
  documentFound: boolean;
  checked: number;
  skippedHumanEdited: number;
  flagged: number;
  flaggedFieldIds: string[];
}

function isHumanEdited(field: DocumentFieldRow): boolean {
  const aiOriginal = (field.ai_answer ?? "").trim();
  const trimmed = (field.answer ?? "").trim();
  return aiOriginal !== "" && aiOriginal !== trimmed;
}

export async function runGtmVoiceCheck(projectId: string, updatedBy: string | null = null): Promise<VoiceCheckSummary> {
  const document = await getDocumentByProject(projectId, "gtm");
  if (!document) return { documentFound: false, checked: 0, skippedHumanEdited: 0, flagged: 0, flaggedFieldIds: [] };

  const fields = await getDocumentFields(document.id);
  const schemaById = new Map(GTM_FIELD_SCHEMA.map(f => [f.id, f]));

  let checked = 0;
  let skippedHumanEdited = 0;
  const flaggedFieldIds: string[] = [];

  for (const field of fields) {
    const schemaField = schemaById.get(field.field_id);
    if (!schemaField || schemaField.kind !== "written") continue;
    if (!field.answer || !field.answer.trim()) continue;
    if (isHumanEdited(field)) {
      skippedHumanEdited++;
      continue;
    }

    const contentType = getToneForGtmField(schemaField.id, schemaField.group?.id);
    if (!contentType) continue;
    checked++;

    const violations = findDeterministicViolations(field.answer, contentType);
    if (violations.length === 0) continue;

    flaggedFieldIds.push(field.field_id);
    await updateDocumentField(document.id, field.field_id, field.answer, updatedBy, {
      source: field.source ?? undefined,
      sourceDetail: { ...(field.source_detail || {}), voiceReview: true, voiceViolations: violations.map(v => v.rule) },
      flagged: true,
    });
  }

  return { documentFound: true, checked, skippedHumanEdited, flagged: flaggedFieldIds.length, flaggedFieldIds };
}
