// Structural anti-hallucination guardrail — same technique already proven
// in lib/amazon-review-analysis.ts's quote verification: after generation,
// every "grounded" field's answer is substring-checked against the actual
// source text. An AI-invented spec value that doesn't trace back to any
// source is discarded before it ever reaches the UI, replaced with N/A
// (or a caller-supplied not-found string) and flagged for visibility.
//
// Deliberately generic (not GTM-specific): TDS's field schema
// (lib/tds-field-schema.ts) has no "kind" tag at all (every TDS field is
// implicitly grounded), so `kind` is optional here and treated as
// "grounded" when absent. This is the one shared hallucination check for
// both documents rather than two copies of the same substring logic.
import { GtmField, GtmFieldAnswer } from "./gtm-field-schema";

export interface SourceTexts {
  projectRecord: string;
  competitiveAnalysis: string;
  tds: string;
  salesKit: string;
}

export interface GroundableField {
  id: string;
  kind?: "grounded" | "written" | "internal";
}

export interface GroundableAnswer {
  answer: string;
  source: string;
  sourceDetail?: any;
  flagged?: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function answerAppearsInText(answer: string, text: string): boolean {
  const needle = normalize(answer);
  if (needle.length < 2) return true; // too trivial to meaningfully verify (e.g. a single digit)
  return normalize(text).includes(needle);
}

// Checks every grounded field's answer against the combined source text
// (callers pass their own list of source text blocks to join). Written
// fields and already-not-found fields pass through untouched.
export function verifyGrounding<T extends GroundableAnswer>(
  fields: Record<string, T>,
  schema: GroundableField[],
  sourceTextBlocks: string[],
  notFoundAnswer: string = "N/A"
): Record<string, T> {
  const combinedText = sourceTextBlocks.join(" \n ");
  const result: Record<string, T> = { ...fields };

  for (const f of schema) {
    const entry = fields[f.id];
    if (!entry) continue;
    if (f.kind === "written") continue;
    if (entry.source === "none" || entry.answer.toUpperCase() === "N/A" || entry.answer === notFoundAnswer) continue;

    if (!answerAppearsInText(entry.answer, combinedText)) {
      result[f.id] = {
        ...entry,
        answer: notFoundAnswer,
        source: "none",
        flagged: true,
        sourceDetail: { reason: "ungrounded", rejectedAnswer: entry.answer, rejectedSource: entry.source },
      };
    }
  }
  return result;
}

export interface ConflictInfo {
  values: { source: string; answer: string }[];
}

// Compares the AI's answer against the deterministic-derivation's answer for
// the same grounded field. If both are real (non-N/A) and disagree, that's a
// genuine conflict between sources — never silently pick one; keep the
// AI's answer as the displayed value (existing priority order) but flag it
// with both values visible.
export function checkConsistency(
  aiFields: Record<string, { answer: string; source: string }> | null,
  derivedFields: Record<string, GtmFieldAnswer>,
  schema: GtmField[]
): Record<string, ConflictInfo> {
  const conflicts: Record<string, ConflictInfo> = {};
  if (!aiFields) return conflicts;

  for (const f of schema) {
    if (f.kind !== "grounded") continue;
    const ai = aiFields[f.id];
    const derived = derivedFields[f.id];
    if (!ai?.answer || !derived?.answer) continue;

    const aiAnswer = ai.answer.trim();
    const derivedAnswer = derived.answer.trim();
    if (!aiAnswer || !derivedAnswer) continue;
    if (aiAnswer.toUpperCase() === "N/A" || derivedAnswer.toUpperCase() === "N/A") continue;

    if (normalize(aiAnswer) !== normalize(derivedAnswer)) {
      conflicts[f.id] = {
        values: [
          { source: ai.source || "multiple", answer: aiAnswer },
          { source: derived.source, answer: derivedAnswer },
        ],
      };
    }
  }
  return conflicts;
}
