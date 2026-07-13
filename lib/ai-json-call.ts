// Shared OpenAI-then-Gemini JSON-generation call, extracted from
// lib/gtm-generate.ts so lib/tds-generate.ts doesn't need a second copy of
// the same fallback logic. Both callers want the same shape: a system
// instruction + user content in, a parsed `{fieldId: {answer, source}}`
// object out, or null if both providers are unavailable/fail.
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { callOpenAiForJson, hasOpenAIKey } from "./openai";

// Generic OpenAI-then-Gemini JSON call — returns whatever shape the system
// instruction's schema describes, or null if both providers are
// unavailable/fail. callAiForFields (below) is the {fieldId:{answer,source}}
// specialization of this for GTM/TDS field generation. OpenAI is primary
// (see lib/openai.ts); Gemini is the fallback.
export async function callAiForJson<T = any>(
  systemInstruction: string,
  userContent: string,
  label: string
): Promise<T | null> {
  if (hasOpenAIKey) {
    const result = await callOpenAiForJson<T>(systemInstruction, userContent, label, { timeoutMs: 25_000 });
    if (result) return result;
  }
  if (hasGeminiKey) {
    try {
      const message = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        config: { systemInstruction, maxOutputTokens: 8192 },
        contents: userContent,
      });
      return JSON.parse(cleanJsonString(message.text || "{}"));
    } catch (err) {
      console.warn(`Gemini ${label} generation failed:`, err);
    }
  }
  return null;
}

export async function callAiForFields(
  systemInstruction: string,
  userContent: string,
  label: string
): Promise<Record<string, { answer: string; source: string }> | null> {
  return callAiForJson(systemInstruction, userContent, label);
}
