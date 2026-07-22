// Narrow, additive-only cross-fill: after GTM generation produces a real
// answer for a field TDS still has at "Not listed on product page" (or its
// own "Not determinable"/"Awaiting internal input" terminal state), copy it
// into TDS. Never calls AI, never re-derives TDS — a straight, already-
// verified fact copy via the existing saveDocumentFields path. Respects
// TDS's deliberate "no AI regenerate route" design (see lib/tds-generate.ts's
// header comment), since this never invokes generation, only storage —
// the same fact must never be answered in GTM and left unresolved in TDS.
import { getDocumentByProject, getDocumentFields, saveDocumentFields } from "./db/documents";
import { TDS_FIELD_SCHEMA } from "./tds-field-schema";
import { isRealAnswer } from "./field-answer-state";

export interface GtmFieldLike {
  answer: string;
  source: string;
}

// gtmFieldsOverride, when provided, is the in-memory result of a
// just-completed GTM generation (see lib/project-generation-engine.ts) —
// using it directly avoids a redundant read-your-own-write DB round trip.
// Omitted, it reads GTM's currently-saved fields from the DB instead (the
// case after a TDS re-capture, where GTM wasn't just regenerated in the
// same request — see app/api/projects/[id]/snapshot/route.ts).
// Returns the number of fields copied.
export async function reconcileTdsFromGtm(
  projectId: string,
  updatedBy: string | null,
  gtmFieldsOverride?: Record<string, GtmFieldLike>
): Promise<number> {
  const tdsDocument = await getDocumentByProject(projectId, "tds");
  if (!tdsDocument) return 0;

  let gtmFields: Record<string, GtmFieldLike>;
  if (gtmFieldsOverride) {
    gtmFields = gtmFieldsOverride;
  } else {
    const gtmDocument = await getDocumentByProject(projectId, "gtm");
    if (!gtmDocument) return 0;
    const rows = await getDocumentFields(gtmDocument.id);
    gtmFields = {};
    for (const r of rows) gtmFields[r.field_id] = { answer: r.answer || "", source: r.source || "none" };
  }

  const tdsRows = await getDocumentFields(tdsDocument.id);
  const tdsById = new Map(tdsRows.map(r => [r.field_id, r]));

  const toCopy: Record<string, { answer: string; source: string }> = {};
  for (const f of TDS_FIELD_SCHEMA) {
    const tdsEntry = tdsById.get(f.id);
    if (tdsEntry && isRealAnswer(tdsEntry.answer)) continue; // TDS already has a real answer — never overwrite

    const gtmEntry = gtmFields[f.id];
    if (gtmEntry && isRealAnswer(gtmEntry.answer)) {
      toCopy[f.id] = { answer: gtmEntry.answer, source: "gtm_cross_fill" };
    }
  }

  const idsToCopy = Object.keys(toCopy);
  if (idsToCopy.length === 0) return 0;

  const schemaSubset = TDS_FIELD_SCHEMA.filter(f => toCopy[f.id]);
  await saveDocumentFields(tdsDocument.id, schemaSubset, toCopy, updatedBy);
  return idsToCopy.length;
}
