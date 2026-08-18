// lib/analyze-form-autofill.ts
// Analyze form quality-of-life — the "Product Description" textarea is
// filled in first and often already states the product's standout spec and
// enough context to infer positioning; this derives short suggestions for
// the "Key differentiating feature" and "Positioning context" fields from
// it, so a user doesn't have to re-type facts they already wrote once.
// Grounded ONLY in the description text passed in — never invents a price
// tier, BSR, or other market fact the text doesn't actually state; returns
// "" for a field with no real basis rather than guessing.
import { callOpenAiForJson } from "./openai";

export interface DescriptionAutofillResult {
  keyDiff: string;
  positioningContext: string;
}

const EMPTY_RESULT: DescriptionAutofillResult = { keyDiff: "", positioningContext: "" };

// Below this length there's rarely enough real signal to extract anything
// meaningful — same 10-character floor the form's own description
// validation already uses (see app/(app)/dashboard/analyze/page.tsx).
const MIN_DESCRIPTION_LENGTH = 10;

export async function autofillFromDescription(productName: string, description: string): Promise<DescriptionAutofillResult> {
  const trimmed = description.trim();
  if (trimmed.length < MIN_DESCRIPTION_LENGTH) return EMPTY_RESULT;

  const systemInstruction = `You are extracting two short fields from a product description for an internal competitive-analysis form about "${productName}". Use ONLY the text below — never invent a fact it doesn't state.

1. "key_diff": the single most standout differentiating feature or spec mentioned (a short phrase, e.g. "full-metal body" or "zero-gap blade with 4-hour battery life"). Return "" if nothing in the text clearly stands out as a differentiator.
2. "positioning_context": 1-2 sentences of genuine positioning-relevant facts EXPLICITLY stated in the text (target audience, use case, a standout claim) — never invent a price tier, sales rank, or other market fact the text doesn't actually say. Return "" if the text has nothing positioning-relevant beyond bare specs.

Return ONLY valid JSON: { "key_diff": "...", "positioning_context": "..." }`;

  const raw = await callOpenAiForJson<{ key_diff?: string; positioning_context?: string }>(
    systemInstruction,
    `Description: ${trimmed}`,
    "AnalyzeForm-DescriptionAutofill",
    { timeoutMs: 15_000, effort: "low" }
  );
  if (!raw) return EMPTY_RESULT;

  const keyDiff = typeof raw.key_diff === "string" ? raw.key_diff.trim() : "";
  const positioningContext = typeof raw.positioning_context === "string" ? raw.positioning_context.trim() : "";
  return {
    keyDiff: keyDiff.toUpperCase() === "N/A" ? "" : keyDiff,
    positioningContext: positioningContext.toUpperCase() === "N/A" ? "" : positioningContext,
  };
}
