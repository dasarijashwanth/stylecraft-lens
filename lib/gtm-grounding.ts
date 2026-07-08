// Structural anti-hallucination guardrail for the GTM generator — same
// technique already proven in lib/amazon-review-analysis.ts's quote
// verification: after generation, every "grounded" field's answer is
// substring-checked against the actual source text. An AI-invented spec
// value that doesn't trace back to any source is discarded before it ever
// reaches the UI, replaced with N/A and flagged for visibility.
import { GtmField, GtmFieldAnswer } from "./gtm-field-schema";

export interface SourceTexts {
  projectRecord: string;
  competitiveAnalysis: string;
  tds: string;
  salesKit: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function answerAppearsInText(answer: string, text: string): boolean {
  const needle = normalize(answer);
  if (needle.length < 2) return true; // too trivial to meaningfully verify (e.g. a single digit)
  return normalize(text).includes(needle);
}

// Checks every grounded field's answer against the combined source text.
// Written fields and already-N/A fields pass through untouched.
export function verifyGrounding(
  fields: Record<string, GtmFieldAnswer>,
  schema: GtmField[],
  sources: SourceTexts
): Record<string, GtmFieldAnswer> {
  const combinedText = [sources.projectRecord, sources.competitiveAnalysis, sources.tds, sources.salesKit].join(" \n ");
  const result: Record<string, GtmFieldAnswer> = { ...fields };

  for (const f of schema) {
    const entry = fields[f.id];
    if (!entry) continue;
    if (f.kind !== "grounded") continue;
    if (entry.source === "none" || entry.answer.toUpperCase() === "N/A") continue;

    if (!answerAppearsInText(entry.answer, combinedText)) {
      result[f.id] = {
        answer: "N/A",
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
