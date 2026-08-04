// The terminal step of both generation pipelines (lib/gtm-generate.ts's
// generateAllFields/generateSingleField, lib/tds-generate.ts's
// generateTdsFields) — called LAST, after every applicable tier (AI, web
// search, derived computation, category default) has already had its turn.
// Converts whatever's still left unresolved into an honest, specific
// terminal state instead of a bare "N/A"/"TBD": genuine human-decision
// fields ("internal" kind, see lib/gtm-field-schema.ts) become
// "Awaiting internal input"; everything else becomes
// "Not found — checked {K} sources" (GTM Schema v3's more specific, auditable
// phrasing — replaces the old one-size-fits-all "Not determinable — {reason}"
// sentence) — so the UI/CSV never shows an unexplained bare placeholder
// again. Never touches a field that already has a real answer.
import { AWAITING_INTERNAL_INPUT, NOT_FOUND_PREFIX, isRealAnswer } from "./field-answer-state";

export interface FinalizableAnswer {
  answer: string;
  source: string;
  sourceDetail?: any;
  flagged?: boolean;
}

export interface FinalizableField {
  id: string;
  kind?: "grounded" | "written" | "internal";
}

export function finalizeFieldAnswers<T extends FinalizableAnswer>(
  fields: Record<string, T>,
  schema: FinalizableField[],
  sourcesChecked: number,
  // Uploaded TDS Ingestion — a pre-launch/custom product's web-search tier
  // never runs (lib/web-search-fallback.ts's skipReason), so the generic
  // "checked K sources" phrasing would falsely imply a web search was
  // attempted and failed. Overrides that phrasing with the real reason.
  terminalReasonOverride?: string
): Record<string, T> {
  const result: Record<string, T> = { ...fields };

  for (const f of schema) {
    const entry = result[f.id];
    if (entry && isRealAnswer(entry.answer)) continue;

    const terminalAnswer = f.kind === "internal"
      ? AWAITING_INTERNAL_INPUT
      : terminalReasonOverride
        ? `${NOT_FOUND_PREFIX}${terminalReasonOverride}`
        : `${NOT_FOUND_PREFIX}checked ${sourcesChecked} source${sourcesChecked === 1 ? "" : "s"}`;
    result[f.id] = {
      ...(entry as T),
      answer: terminalAnswer,
      source: "none",
      // The reason is now spelled out in the answer text itself — a
      // leftover `flagged: true` badge alongside it would be redundant.
      flagged: false,
    } as T;
  }

  return result;
}
