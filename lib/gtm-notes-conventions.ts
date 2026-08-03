// lib/gtm-notes-conventions.ts
// GTM style-corpus work, Part E — deterministic (non-AI) Notes conventions
// confirmed against the real GTM sheets. Runs as a final synchronous pass
// after AI/web/Tier 6/6.5/Tier 7 have already resolved each field's
// answer, using the new Notes-generation plumbing (lib/gtm-field-
// schema.ts's GtmFieldAnswer.notes -> lib/db/documents.ts's
// saveDocumentFields, which never lets a generated note overwrite a
// human's own — see that file's `prior?.notes ?? next.notes` ordering).
//
// The real sheets' "guard measurement breakdown" convention
// ("Small comb: 2mm, 3mm; Large comb: 4mm, 5mm") is deliberately NOT
// duplicated here — lib/gtm-generate.ts's buildSystemInstruction already
// instructs the AI to write that breakdown directly into guards_type's own
// answer text when the sources provide it (see its REQUIRED DEPTH section),
// so mirroring the same text into Notes would just be redundant.
import { GtmField, GtmFieldAnswer } from "./gtm-field-schema";
import { isRealAnswer } from "./field-answer-state";
import type { GtmSources } from "./gtm-generate";

function isExplicitNA(value: string | null | undefined): boolean {
  return (value ?? "").toString().trim().toUpperCase() === "N/A";
}

// Confirmed via the real S|C x 360 Jeezy Trimmer GTM sheet: a trimmer
// genuinely has neither a lever nor guards, and its TDS capture explicitly
// records "N/A" for both — a genuine physical fact, not a missing-data
// gap. Only applies to a full TOOL — an accessory/replacement part already
// gets these fields forced to plain structural N/A with no Notes needed
// (see lib/gtm-generate.ts's structurallyInapplicableFieldIds).
const LEVER_GUARDS_NOTE: Record<string, string> = {
  lever_type: "No lever.",
  guards_type: "No guards.",
};

// The AI is already instructed (buildSystemInstruction's REQUIRED DEPTH
// section) to note a pre-assembled part directly in axis_shield_qty/
// cam_follower_qty's own answer text (e.g. "2 (1 assembled)"), confirmed
// against the real Jeezy Trimmer sheet's "Axis Shield Qty: 2 (1
// assembled)" / "Cam Follower Qty: 1 (assembled on unit)". This moves that
// parenthetical OUT of the answer (which should stay a clean quantity) and
// into Notes instead.
const ASSEMBLED_QTY_FIELD_IDS = ["axis_shield_qty", "cam_follower_qty"] as const;
const ASSEMBLED_PATTERN = /\s*\(([^)]*assembled[^)]*)\)\s*$/i;

export function applyDeterministicNotesConventions(
  fields: Record<string, GtmFieldAnswer>,
  schema: GtmField[],
  sources: GtmSources,
  productKind: string | null | undefined
): void {
  const tds = sources.tds || {};

  if (!productKind || productKind === "tool") {
    for (const fieldId of Object.keys(LEVER_GUARDS_NOTE)) {
      if (!schema.some(f => f.id === fieldId)) continue;
      const current = fields[fieldId];
      if (!current || current.notes || isRealAnswer(current.answer)) continue;
      if (!isExplicitNA(tds[fieldId])) continue;
      fields[fieldId] = { ...current, notes: LEVER_GUARDS_NOTE[fieldId] };
    }
  }

  for (const fieldId of ASSEMBLED_QTY_FIELD_IDS) {
    if (!schema.some(f => f.id === fieldId)) continue;
    const current = fields[fieldId];
    if (!current || current.notes) continue;
    const match = current.answer.match(ASSEMBLED_PATTERN);
    if (!match) continue;
    fields[fieldId] = {
      ...current,
      answer: current.answer.replace(ASSEMBLED_PATTERN, "").trim(),
      notes: `(${match[1].trim()})`,
    };
  }
}
