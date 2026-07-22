// Shared tier-5 (real web search) fallback for BOTH GTM and TDS field
// generation — extracted from lib/gtm-generate.ts's original
// applyWebSearchFallback so TDS (which had ZERO web search capability
// before this) gets the identical, already-proven mechanism instead of a
// second copy. One web_search-enabled call handles the common case (few
// fields still eligible — TDS's usual case, given its snapshot-based floor
// already fills most fields); a chunked Promise.all — the same pattern
// lib/gtm-generate.ts's main generation call already uses successfully for
// its full 77-field sweep — only kicks in for the worst case (many fields
// eligible at once, e.g. TDS with no ASIN captured at all), since a single
// call covering that many fields with real web search reliably times out.
import { openai, hasOpenAIKey, OPENAI_MODEL } from "./openai";
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { coerceAiAnswer } from "./ai-json-call";
import { isRealAnswer } from "./field-answer-state";

export interface WebFallbackField {
  id: string;
  question: string;
}

export interface WebFallbackAnswer {
  answer: string;
  source: string;
  sourceDetail?: any;
  flagged?: boolean;
}

// Above this many still-eligible fields, split into evenly-sized chunks run
// concurrently instead of one call — mirrors lib/gtm-generate.ts's own
// FIELDS_PER_CHUNK-based main-call chunking, which is what actually makes a
// large sweep finish reliably instead of timing out.
const CHUNK_SIZE = 6;
const CHUNK_THRESHOLD = 10;
const SINGLE_CALL_TIMEOUT_MS = 10_000;
const CHUNK_CALL_TIMEOUT_MS = 20_000;

interface WebSearchResult {
  parsed: Record<string, any>;
  queries: string[];
}

async function runOneWebSearchCall(
  eligible: WebFallbackField[],
  productName: string,
  timeoutMs: number
): Promise<WebSearchResult | null> {
  const fieldList = eligible.map(f => `- ${f.id}: ${f.question}`).join("\n");
  const systemInstruction = `Search the web for verifiable public information about the product "${productName}" to answer the fields below. Use ONLY information you find via search — never guess or use general knowledge about similar products. If nothing reliable is found for a field, return "N/A".

Do not narrate your search process — search silently, then respond with ONLY the final JSON object. No preamble, no commentary.

Return ONLY valid JSON, no markdown, keyed by field id: { "<field_id>": { "answer": "..." } }

FIELDS:
${fieldList}`;

  // OpenAI is primary — its own native web_search tool handles the lookup.
  // Gemini's googleSearch is the fallback if OpenAI is unavailable/fails.
  if (hasOpenAIKey) {
    try {
      const response: any = await openai.responses.create(
        {
          model: OPENAI_MODEL,
          reasoning: { effort: "low" },
          // max_tool_calls bounds search chaining; without it a single call
          // can run away (see lib/analysisEngine.ts's runOpenAiWebSearch for
          // the same lesson learned from the prior, now-removed Anthropic
          // integration).
          tools: [{ type: "web_search" as any }],
          max_tool_calls: 4,
          instructions: systemInstruction,
          input: `Product: ${productName}`,
        } as any,
        { timeout: timeoutMs }
      );
      const queries: string[] = (response.output || [])
        .filter((o: any) => o.type === "web_search_call")
        .flatMap((o: any) => o.action?.queries || (o.action?.query ? [o.action.query] : []));
      const message = (response.output || []).find((o: any) => o.type === "message");
      const text: string = message?.content?.find((c: any) => c.type === "output_text")?.text || response.output_text || "";
      const parsed = JSON.parse(cleanJsonString(text || "{}"));
      return { parsed, queries };
    } catch (err) {
      console.warn("OpenAI web-search fallback failed, trying Gemini:", err);
    }
  }

  if (!hasGeminiKey) return null;
  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Product: ${productName}`,
      config: { systemInstruction, tools: [{ googleSearch: {} }], maxOutputTokens: 2048 },
    });
    const queries: string[] = response.candidates?.[0]?.groundingMetadata?.webSearchQueries || [];
    const parsed = JSON.parse(cleanJsonString(response.text || "{}"));
    return { parsed, queries };
  } catch (err) {
    console.warn("Gemini web-search fallback failed:", err);
    return null;
  }
}

// Mutates `fields` in place — same contract as the original GTM-only
// version. `isRealAnswer` (not a bare "N/A" check) decides eligibility, so
// TDS's "Not listed on product page" sentinel is automatically covered
// without a second, doc-specific eligibility check.
export async function applyWebSearchFallback<T extends WebFallbackAnswer>(
  fields: Record<string, T>,
  schema: WebFallbackField[],
  productName: string,
  pipelineStart: number,
  timeBudgetMs: number
): Promise<void> {
  const eligible = schema.filter(f => !isRealAnswer(fields[f.id]?.answer));
  if (eligible.length === 0 || (!hasOpenAIKey && !hasGeminiKey)) return;
  if (Date.now() - pipelineStart > timeBudgetMs) return;

  const applyResult = (targets: WebFallbackField[], result: WebSearchResult | null) => {
    if (!result) return;
    for (const f of targets) {
      const answer = coerceAiAnswer(result.parsed?.[f.id]?.answer);
      if (answer && answer.toUpperCase() !== "N/A") {
        fields[f.id] = { ...(fields[f.id] as object), answer, source: "web", sourceDetail: { webSearchQueries: result.queries }, flagged: false } as T;
      }
    }
  };

  if (eligible.length <= CHUNK_THRESHOLD) {
    const result = await runOneWebSearchCall(eligible, productName, SINGLE_CALL_TIMEOUT_MS);
    applyResult(eligible, result);
    return;
  }

  // Worst case (many fields still eligible, e.g. TDS with no ASIN at all) —
  // one call per evenly-sized chunk, run concurrently: a single call
  // covering this many fields with real web search reliably times out (the
  // same lesson lib/gtm-generate.ts's main call already learned).
  const chunks: WebFallbackField[][] = [];
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) chunks.push(eligible.slice(i, i + CHUNK_SIZE));

  await Promise.all(
    chunks.map(async chunk => {
      if (Date.now() - pipelineStart > timeBudgetMs) return;
      const result = await runOneWebSearchCall(chunk, productName, CHUNK_CALL_TIMEOUT_MS);
      applyResult(chunk, result);
    })
  );
}
