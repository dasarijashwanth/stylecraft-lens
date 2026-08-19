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
import { assertToolType, buildToolTypePromptGuard, ToolType } from "./tool-type-taxonomy";
import type { ToolTypeRow } from "./db/tool-types";

export interface WebFallbackField {
  id: string;
  question: string;
  // GTM's select-kind fields (Core Consumer, Noise level) — a web answer
  // not exactly matching one of these (case-insensitive) is rejected
  // rather than accepted as free text. Absent (and therefore skipped) for
  // every other field, and for TDS entirely (no select-kind TDS fields).
  options?: string[];
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
// Bumped from 10s/20s — confirmed live this session that a real web_search-
// enabled gpt-5 call routinely needs 25-40s+, making the old values an
// effectively-neutered fallback tier (almost always timing out before ever
// returning a real answer). Kept below the sibling full-generation calls'
// 30s (rather than matching them) since this tier is already gated by the
// caller's own overall elapsed-time budget (timeBudgetMs) — a bigger jump
// here would risk eating too much of what's left for Tier 6/6.5 afterward.
const SINGLE_CALL_TIMEOUT_MS = 15_000;
const CHUNK_CALL_TIMEOUT_MS = 25_000;

interface WebSearchResult {
  parsed: Record<string, any>;
  queries: string[];
}

async function runOneWebSearchCall(
  eligible: WebFallbackField[],
  productName: string,
  timeoutMs: number,
  toolTypes: ToolTypeRow[],
  requiredToolType?: ToolType | null,
  // Brand Voice Guide — a field resolved here becomes its FINAL answer just
  // like one resolved by the main AI call, so a "written"-kind GTM field
  // (positioning/reason-to-buy/etc.) that falls through to this tier needs
  // the same voice grounding, not just whatever gtm-generate.ts's later
  // guardWrittenFieldsQuality pass happens to catch as a deterministic rule
  // violation (a flat/generic-but-not-rule-violating answer could slip
  // through that check untouched). No-op for TDS's caller, which has no
  // "written"-kind fields to begin with.
  voiceBlock: string = ""
): Promise<WebSearchResult | null> {
  const fieldList = eligible.map(f => `- ${f.id}: ${f.question}`).join("\n");
  // This path has no independent page-fetch/quote-verification step (unlike
  // lib/amazon-review-analysis.ts / lib/key-features-resolver.ts, which
  // fetch and check the actual page text) — the JSON-only response mode
  // this call uses also suppresses real url_citation annotations (see
  // lib/web-search.ts's own header comment), so there's no structurally
  // verifiable source URL available here. The explicit tool-type guard
  // below plus the required source_hint (checked against assertToolType
  // in applyResult) is the real, code-enforced safeguard this path can
  // actually support given that constraint.
  const toolTypeGuard = requiredToolType ? `\n\n${buildToolTypePromptGuard(requiredToolType, toolTypes)}` : "";
  const systemInstruction = `Search the web for verifiable public information about the product "${productName}" to answer the fields below. Use ONLY information you find via search — never guess or use general knowledge about similar products.${toolTypeGuard} If nothing reliable is found for a field, return "N/A".

Do not narrate your search process — search silently, then respond with ONLY the final JSON object. No preamble, no commentary.

Return ONLY valid JSON, no markdown, keyed by field id: { "<field_id>": { "answer": "...", "source_hint": "the site/page name or article title this came from" } }

FIELDS:
${fieldList}${voiceBlock}`;

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
  timeBudgetMs: number,
  toolTypes: ToolTypeRow[],
  requiredToolType?: ToolType | null,
  // Uploaded TDS Ingestion — a pre-launch/custom product (no productUrl/
  // asin/Reference Links) has no web presence for this tier to find
  // anything; passing a reason skips the attempt entirely instead of
  // searching for nothing. lib/field-finalize.ts's terminalReasonOverride
  // surfaces WHY a field still ended up unresolved, so the honest reason
  // threads through both.
  skipReason?: string,
  // Brand Voice Guide — see runOneWebSearchCall's own comment on why a
  // field resolved here needs the same voice grounding as one resolved by
  // the main AI call.
  voiceBlock: string = ""
): Promise<void> {
  const eligible = schema.filter(f => !isRealAnswer(fields[f.id]?.answer));
  if (eligible.length === 0 || (!hasOpenAIKey && !hasGeminiKey)) return;
  if (Date.now() - pipelineStart > timeBudgetMs) return;
  if (skipReason) return;

  const applyResult = (targets: WebFallbackField[], result: WebSearchResult | null) => {
    if (!result) return;
    for (const f of targets) {
      const raw = result.parsed?.[f.id];
      const answer = coerceAiAnswer(raw?.answer);
      if (!answer || answer.toUpperCase() === "N/A") continue;
      if (f.options && !f.options.some(o => o.toLowerCase() === answer.toLowerCase())) continue;

      // No independent page fetch on this path (see runOneWebSearchCall's
      // own comment) — the model's self-reported source_hint is the only
      // signal available, checked against a known mismatch the same way
      // every other tier does. A missing/empty hint isn't itself rejected
      // (nothing concrete to contradict), only a hint that positively
      // resolves to a DIFFERENT tool type.
      if (requiredToolType && raw?.source_hint && !assertToolType(String(raw.source_hint), requiredToolType, toolTypes).ok) {
        console.warn(`[tool-type] rejected web-fallback answer for field "${f.id}" — source_hint "${raw.source_hint}" doesn't match required type ${requiredToolType}`);
        continue;
      }

      fields[f.id] = { ...(fields[f.id] as object), answer, source: "web", sourceDetail: { webSearchQueries: result.queries }, flagged: false } as T;
    }
  };

  if (eligible.length <= CHUNK_THRESHOLD) {
    const result = await runOneWebSearchCall(eligible, productName, SINGLE_CALL_TIMEOUT_MS, toolTypes, requiredToolType, voiceBlock);
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
      const result = await runOneWebSearchCall(chunk, productName, CHUNK_CALL_TIMEOUT_MS, toolTypes, requiredToolType, voiceBlock);
      applyResult(chunk, result);
    })
  );
}
