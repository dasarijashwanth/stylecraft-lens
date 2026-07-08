// Shared Gemini-then-Anthropic JSON-generation call, extracted from
// lib/gtm-generate.ts so lib/tds-generate.ts doesn't need a second copy of
// the same fallback logic. Both callers want the same shape: a system
// instruction + user content in, a parsed `{fieldId: {answer, source}}`
// object out, or null if both providers are unavailable/fail.
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { anthropic, hasAnthropicKey, ANTHROPIC_MODEL } from "./anthropic";

export async function callAiForFields(
  systemInstruction: string,
  userContent: string,
  label: string
): Promise<Record<string, { answer: string; source: string }> | null> {
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
  if (hasAnthropicKey) {
    try {
      const message = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        system: systemInstruction,
        messages: [{ role: "user", content: userContent }],
      });
      const text = message.content.filter(b => b.type === "text").map((b: any) => b.text).join("\n");
      return JSON.parse(cleanJsonString(text || "{}"));
    } catch (err) {
      console.warn(`Anthropic ${label} generation failed:`, err);
    }
  }
  return null;
}
