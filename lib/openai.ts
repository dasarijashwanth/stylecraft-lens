import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY || "";

// maxRetries: 0 — the SDK's default (2 retries) would silently multiply
// every per-call timeout below by up to 3x (confirmed in testing: a 20s
// timeout took ~55-60s wall-clock because the SDK retried the timed-out
// request twice more on its own). This app already has its own deliberate,
// budget-aware retry logic (createResponseWithRetry below), so the SDK's
// automatic retries would only double up and blow through Vercel's 60s cap.
export const openai = new OpenAI({ apiKey: apiKey || "mock-key-for-development", maxRetries: 0 });

// Sole AI provider for the app — analysis/synthesis (competitive analysis,
// GTM, sales kit, reviews, rewrite) and web search/scraping all go through
// OpenAI now. Anthropic was removed after its account ran out of credit
// balance; Gemini remains only as amazon-review-analysis.ts's legacy
// fallback in a couple of call sites, not a primary path anywhere.
export const hasOpenAIKey = !!apiKey && apiKey !== "";

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

// Strip markdown fences and extract the JSON object/array itself — same
// balanced-bracket approach as lib/gemini.ts's cleanJsonString, needed here
// too since the Responses API's web_search tool produces prose alongside
// (or instead of) clean JSON when it narrates/cites sources inline.
export function cleanJsonString(text: string): string {
  const fenceStripped = text.replace(/```json|```/g, "").trim();
  const firstBrace = fenceStripped.indexOf("{");
  const firstBracket = fenceStripped.indexOf("[");
  const starts = [firstBrace, firstBracket].filter(i => i !== -1);
  if (starts.length === 0) return fenceStripped;
  const start = Math.min(...starts);
  const open = fenceStripped[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < fenceStripped.length; i++) {
    if (fenceStripped[i] === open) depth++;
    else if (fenceStripped[i] === close) {
      depth--;
      if (depth === 0) return fenceStripped.slice(start, i + 1);
    }
  }
  return fenceStripped.slice(start);
}

// A short wait-and-retry on rate limiting — same lesson learned from the
// Anthropic migration (a brief pause often clears a per-minute window
// rather than failing outright). Kept short so total latency stays well
// under Vercel's 60s function cap even with one retry.
const RATE_LIMIT_RETRY_DELAY_MS = 6_000;

function isRateLimitError(err: any): boolean {
  return err?.status === 429;
}

async function createResponseWithRetry(params: any, timeoutMs: number): Promise<any> {
  try {
    return await openai.responses.create(params, { timeout: timeoutMs });
  } catch (err) {
    if (!isRateLimitError(err)) throw err;
    console.warn(`OpenAI rate limit hit, waiting ${RATE_LIMIT_RETRY_DELAY_MS}ms before one retry...`);
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
    return await openai.responses.create(params, { timeout: timeoutMs });
  }
}

export interface OpenAiSearchResult<T> {
  data: T | null;
  citations: { url: string; title: string }[];
}

// Search-and-extract via OpenAI's native web_search tool: searches, opens
// real pages, and returns structured JSON grounded in what it actually
// read (confirmed in testing: it opened the real product page and cited it,
// and explicitly said so when the exact product name didn't match rather
// than guessing). max_tool_calls bounds search/page-open iterations so a
// single call can't run away the way an uncapped Claude web_search call did
// in the prior (now-removed) Anthropic integration.
export async function searchAndExtractJson<T = any>(
  systemInstruction: string,
  userQuery: string,
  timeoutMs = 30_000,
  maxToolCalls = 3
): Promise<OpenAiSearchResult<T>> {
  if (!hasOpenAIKey) return { data: null, citations: [] };

  const response: any = await createResponseWithRetry(
    {
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" as any }],
      max_tool_calls: maxToolCalls,
      instructions: systemInstruction,
      input: userQuery,
    },
    timeoutMs
  );

  const message = (response.output || []).find((o: any) => o.type === "message");
  const textBlock = message?.content?.find((c: any) => c.type === "output_text");
  const text: string = textBlock?.text || response.output_text || "";
  const citations = (textBlock?.annotations || [])
    .filter((a: any) => a.type === "url_citation")
    .map((a: any) => ({ url: a.url, title: a.title }));

  if (!text) return { data: null, citations };
  try {
    return { data: JSON.parse(cleanJsonString(text)), citations };
  } catch {
    return { data: null, citations };
  }
}

// General-purpose JSON generation — the OpenAI equivalent of the old
// lib/ai-json-call.ts / lib/anthropic.ts combo. `webSearch: true` attaches
// the native web_search tool for calls that need live grounding (analysis,
// identification, GTM field lookups); omit it for pure text/JSON tasks
// (review analysis, sales-kit copy, rewrite) where no search is needed and
// skipping the tool means faster, cheaper responses.
export async function callOpenAiForJson<T = any>(
  systemInstruction: string,
  userContent: string,
  label: string,
  opts?: { webSearch?: boolean; maxToolCalls?: number; timeoutMs?: number; effort?: "low" | "medium" | "high" }
): Promise<T | null> {
  if (!hasOpenAIKey) return null;

  const timeoutMs = opts?.timeoutMs ?? 25_000;
  try {
    const response: any = await createResponseWithRetry(
      {
        model: OPENAI_MODEL,
        reasoning: { effort: opts?.effort ?? "low" },
        ...(opts?.webSearch
          ? { tools: [{ type: "web_search" as any }], max_tool_calls: opts?.maxToolCalls ?? 4 }
          : {}),
        instructions: systemInstruction,
        input: userContent,
      },
      timeoutMs
    );

    const message = (response.output || []).find((o: any) => o.type === "message");
    const textBlock = message?.content?.find((c: any) => c.type === "output_text");
    const text: string = textBlock?.text || response.output_text || "";
    if (!text) return null;
    return JSON.parse(cleanJsonString(text));
  } catch (err) {
    console.warn(`OpenAI ${label} generation failed:`, err);
    return null;
  }
}
