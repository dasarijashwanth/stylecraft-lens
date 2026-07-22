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
  label: string,
  opts?: { webSearch?: boolean; maxToolCalls?: number; timeoutMs?: number; projectId?: string }
): Promise<T | null> {
  if (hasOpenAIKey) {
    const result = await callOpenAiForJson<T>(systemInstruction, userContent, label, {
      timeoutMs: opts?.timeoutMs ?? 25_000,
      webSearch: opts?.webSearch,
      maxToolCalls: opts?.maxToolCalls,
      projectId: opts?.projectId,
    });
    if (result) return result;
  }
  if (hasGeminiKey) {
    try {
      const message = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        config: {
          systemInstruction,
          maxOutputTokens: 8192,
          ...(opts?.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
        },
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
  label: string,
  opts?: { webSearch?: boolean; maxToolCalls?: number; timeoutMs?: number; projectId?: string }
): Promise<Record<string, { answer: string; source: string }> | null> {
  return callAiForJson(systemInstruction, userContent, label, opts);
}

// A field's `answer` is typed string, but it's really untrusted JSON parsed
// from the AI's own response — confirmed live that a malformed/partial
// response (e.g. a chunk recovering from a timeout) can hand back a bare
// number or nested object instead of a string, which has no .trim() method
// and crashes the whole generation step. Every call site that reads an
// AI-returned answer should go through this instead of `.answer?.trim()`
// directly.
export function coerceAiAnswer(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (value == null) return undefined;
  return String(value).trim();
}
