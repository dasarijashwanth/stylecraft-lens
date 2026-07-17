// Real, product-specific news search via OpenAI's native web_search tool —
// no invented headlines, no substituting generic category news for a
// specific product's own news.
//
// Important lesson learned in testing: OpenAI only attaches url_citation
// annotations (real url/title tied to a specific span of text) when the
// model answers in natural prose with inline citations — forcing strict
// "return ONLY JSON" output suppresses annotations entirely (confirmed:
// the exact same search that produced 9 real citations in prose mode
// produced ZERO annotations when the same request asked for pure JSON,
// even though the JSON itself contained real, correct URLs). So this asks
// for prose, extracts news items directly from the model's own annotated
// citations (never inventing a URL/title beyond what OpenAI's search
// infrastructure actually attached), rather than trusting a self-reported
// JSON structure with no way to verify it against real search results.
import { openai, hasOpenAIKey, OPENAI_MODEL } from "./openai";
import { SectionProvenanceData, ProvenanceTier, ProvenanceQuery } from "./section-provenance";

export interface NewsItem {
  title: string;
  summary: string;
  url: string;
  publisher: string;
  date: string | null;
}

export interface ProductNewsResult {
  items: NewsItem[];
  categoryContext: NewsItem[];
  searchedAt: string;
  aiUnavailable: boolean;
  // Persisted, section-level source trail (see lib/section-provenance.ts) —
  // additive/optional so cached pre-existing payloads without it stay valid.
  provenance?: SectionProvenanceData;
}

// Splits the model's own self-reported "Excluded sources:" tail (added to
// the prompt below) from the real prose. This count is UNVERIFIED — OpenAI's
// web_search tool doesn't expose an internal considered-vs-discarded count,
// so this is the model's own self-report, never treated with the same
// confidence as a code-checked rejection elsewhere in this app. Exported so
// it's independently testable offline (no live call needed).
const EXCLUDED_MARKER = /excluded sources:/i;

export function parseExcludedSources(text: string): { markerIndex: number; rejectedCount: number; rejectedReasons: string[] } {
  const match = EXCLUDED_MARKER.exec(text);
  if (!match) return { markerIndex: text.length, rejectedCount: 0, rejectedReasons: [] };

  const tail = text.slice(match.index + match[0].length);
  const reasons = tail
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^none\.?$/i.test(l));

  return { markerIndex: match.index, rejectedCount: reasons.length, rejectedReasons: reasons };
}

const NEWS_TIMEOUT_MS = 40_000;
const DATE_PATTERN = /\b(20\d{2}-\d{2}-\d{2})\b/;

function currentYear(referenceDate: Date): number {
  return referenceDate.getUTCFullYear();
}

function buildPrompt(productName: string, brand: string | null, referenceDate: Date) {
  const year = currentYear(referenceDate);
  const brandLine = brand ? `"${brand}" "${productName}"` : `"${productName}"`;
  const searchQueries = [`"${productName}" news`, `${brandLine} launch OR recall OR update OR award ${year}`];

  const systemPrompt = `You are searching for real, recent news about ONE specific product. Search the web for:
- ${searchQueries[0]}
- ${searchQueries[1]}

Restrict to articles from roughly the last 12 months where you can tell the date. Only report an item if it is genuinely about THIS SPECIFIC PRODUCT (not the brand in general, not a different product in the same category) — say so explicitly if a source is about the category/brand in general rather than this exact product.

Do not narrate your search process. Write a short plain-text summary (not JSON) covering what you found: for each real item, one sentence stating the headline/topic, the publisher, and the date if known, with an inline citation. If you find nothing specific to this exact product, say so plainly instead of describing general category or brand news.

At the very end of your response, on a new line beginning exactly with "Excluded sources:", briefly list any sources you found but did NOT report above because they were about the brand or category in general rather than this exact product — one per line, each with a short reason. If there were none, write "Excluded sources: none".`;

  const userPrompt = `Product: ${productName}${brand ? `\nBrand: ${brand}` : ""}\nToday's date: ${referenceDate.toISOString().slice(0, 10)}`;
  return { systemPrompt, userPrompt, searchQueries };
}

function normalizeUrl(url: string): string {
  return (url || "").split("?")[0].replace(/\/$/, "").toLowerCase();
}

function derivePublisher(title: string, url: string): string {
  const dashSplit = title.split(" - ");
  if (dashSplit.length > 1) return dashSplit[dashSplit.length - 1].trim();
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function findProductNews(productName: string, brand: string | null, referenceDate: Date = new Date()): Promise<ProductNewsResult> {
  const searchedAt = referenceDate.toISOString();
  const t0 = Date.now();
  const NO_KEY_TIER: ProvenanceTier = { tier: "Product news web search", attempted: false, outcome: "skipped", errorMessage: "OpenAI not configured" };

  if (!hasOpenAIKey) {
    return { items: [], categoryContext: [], searchedAt, aiUnavailable: true, provenance: { tiers: [NO_KEY_TIER], queries: [] } };
  }

  const { systemPrompt, userPrompt, searchQueries } = buildPrompt(productName, brand, referenceDate);
  const baseQueries: ProvenanceQuery[] = searchQueries.map(q => ({ tier: "Product news web search", query: q, verified: true }));

  try {
    const response: any = await openai.responses.create(
      {
        model: OPENAI_MODEL,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" as any }],
        max_tool_calls: 5,
        instructions: systemPrompt,
        input: userPrompt,
      } as any,
      { timeout: NEWS_TIMEOUT_MS }
    );

    const message = (response.output || []).find((o: any) => o.type === "message");
    const textBlock = message?.content?.find((c: any) => c.type === "output_text");
    const text: string = textBlock?.text || response.output_text || "";
    const rawAnnotations: any[] = textBlock?.annotations || [];
    const { markerIndex, rejectedCount, rejectedReasons } = parseExcludedSources(text);
    // Only annotations before the self-reported "Excluded sources:" tail
    // count as real news — the tail describes sources the model itself
    // decided NOT to report, so its citations (if any) must never leak
    // into the real items list.
    const annotations = rawAnnotations.filter(a => (a.start_index ?? 0) < markerIndex);
    const excludedQuery: ProvenanceQuery = {
      tier: "Product news web search", query: "self-reported excluded (not-product-specific) sources",
      verified: false, rejectedCount, rejectedReasons: rejectedReasons.length ? rejectedReasons : undefined,
    };

    if (!text || annotations.length === 0) {
      // Either the model found nothing (plausible — most products have no
      // dedicated coverage) or the call otherwise produced no verifiable
      // citations. Either way, an empty result is the honest answer here,
      // not a failure — only treat it as aiUnavailable if there's no text
      // at all (the call itself produced nothing).
      const tier: ProvenanceTier = { tier: "Product news web search", attempted: true, outcome: text ? "empty" : "error", itemCount: 0, elapsedMs: Date.now() - t0, errorMessage: text ? undefined : "no response text" };
      return { items: [], categoryContext: [], searchedAt, aiUnavailable: !text, provenance: { tiers: [tier], queries: [...baseQueries, excludedQuery] } };
    }

    // Group citations by URL — the same article is often cited more than
    // once across different sentences. The annotation's own [start,end)
    // span usually covers just the inline citation markup itself (e.g.
    // "([site.com](url))"), not the sentence it's attached to — so this
    // widens the span outward to the nearest sentence boundaries before
    // and after, giving a real descriptive summary instead of raw
    // citation syntax, while still only ever using text that genuinely
    // appears in the model's own response.
    const SENTENCE_BOUNDARY = /[.!?]\s/;
    const widenToSentence = (start: number, end: number): string => {
      let s = start;
      while (s > 0 && !SENTENCE_BOUNDARY.test(text.slice(Math.max(0, s - 2), s))) s--;
      let e = end;
      while (e < text.length && !SENTENCE_BOUNDARY.test(text.slice(e, e + 2))) e++;
      return text.slice(s, Math.min(e + 1, text.length))
        .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, "") // strip inline markdown citation links
        .replace(/\s+/g, " ")
        .trim();
    };

    const byUrl = new Map<string, { title: string; url: string; spans: string[] }>();
    for (const a of annotations) {
      if (a.type !== "url_citation" || !a.url) continue;
      const key = normalizeUrl(a.url);
      const span = widenToSentence(a.start_index, a.end_index);
      const existing = byUrl.get(key);
      if (existing) {
        if (span && !existing.spans.includes(span)) existing.spans.push(span);
      } else {
        byUrl.set(key, { title: a.title || "", url: a.url, spans: span ? [span] : [] });
      }
    }

    const items: NewsItem[] = Array.from(byUrl.values()).map(({ title, url, spans }) => {
      const summary = spans.join(" ").slice(0, 400);
      const dateMatch = summary.match(DATE_PATTERN);
      return {
        title: title || derivePublisher(title, url),
        summary,
        url,
        publisher: derivePublisher(title, url),
        date: dateMatch ? dateMatch[1] : null,
      };
    });

    const tier: ProvenanceTier = {
      tier: "Product news web search", attempted: true, outcome: items.length > 0 ? "success" : "empty",
      itemCount: items.length, sourceUrls: items.map(i => i.url), elapsedMs: Date.now() - t0,
    };
    return { items, categoryContext: [], searchedAt, aiUnavailable: false, provenance: { tiers: [tier], queries: [...baseQueries, excludedQuery] } };
  } catch (err) {
    console.warn("OpenAI product news search failed:", err);
    const tier: ProvenanceTier = { tier: "Product news web search", attempted: true, outcome: "error", elapsedMs: Date.now() - t0, errorMessage: String((err as any)?.message ?? err) };
    return { items: [], categoryContext: [], searchedAt, aiUnavailable: true, provenance: { tiers: [tier], queries: baseQueries } };
  }
}
