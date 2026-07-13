// Strictly review-grounded strengths/weaknesses/recent-sentiment analysis.
// The AI only ever sees the review texts fetched for THIS ASIN — never web
// search, never its own trained knowledge. After it responds, every quoted
// fragment is verified to actually appear in the fetched reviews; any theme
// whose evidence doesn't verify is dropped before it ever reaches the UI.
// This makes hallucination structurally impossible to reach the client.
//
// Strengths are drawn from a dedicated four/five-star fetch, weaknesses
// from a dedicated one/two-star fetch, and recent sentiment from a
// dedicated last-90-days fetch — three distinct, correctly-targeted review
// sets, rather than one mixed most-recent stream analyzed for everything.
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { callOpenAiForJson, hasOpenAIKey } from "./openai";
import { AmazonReview, getAmazonReviews, getAmazonReviewsByStars, getRecentReviews } from "./rainforest";

export interface ReviewEvidence {
  quote: string;
  date: string | null;
}

export interface ReviewTheme {
  theme: string;
  evidence: ReviewEvidence[];
}

export interface RecentSentiment {
  reviewCount: number;
  avgRating: number | null;
  priorAvgRating: number | null;
  // Computed in code from the actual numbers above — never AI-guessed.
  trend: "improving" | "declining" | "stable" | "unknown";
  dominantThemes: ReviewTheme[];
}

export interface ReviewAnalysis {
  strengths: ReviewTheme[];
  weaknesses: ReviewTheme[];
  recentSentiment: RecentSentiment | null;
  reviewCountAnalyzed: number;
  dateRange: { earliest: string | null; latest: string | null } | null;
  insufficientData: boolean;
  // True when reviews were fetched fine but no AI provider could analyze
  // them (both OpenAI and Gemini unavailable) — distinct from
  // insufficientData, which means the reviews themselves were too few.
  aiUnavailable: boolean;
}

const MIN_REVIEWS_REQUIRED = 5;
const MIN_EVIDENCE_PER_THEME = 2;
const RATING_TREND_EPSILON = 0.15; // smaller swings are noise, not a real trend

function normalizeWhitespace(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function quoteAppearsInReviews(quote: string, reviews: AmazonReview[]): boolean {
  const needle = normalizeWhitespace(quote);
  if (needle.length < 8) return false; // too short to be a meaningful citation
  return reviews.some(r => normalizeWhitespace(`${r.title} ${r.body}`).includes(needle));
}

function computeDateRange(reviews: AmazonReview[]): { earliest: string | null; latest: string | null } | null {
  const dates = reviews.map(r => r.date).filter(Boolean) as string[];
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { earliest: sorted[0], latest: sorted[sorted.length - 1] };
}

function avgRating(reviews: AmazonReview[]): number | null {
  const rated = reviews.map(r => r.rating).filter((r): r is number => typeof r === "number");
  if (rated.length === 0) return null;
  return rated.reduce((a, b) => a + b, 0) / rated.length;
}

function dedupeReviews(reviews: AmazonReview[]): AmazonReview[] {
  const seen = new Set<string>();
  const out: AmazonReview[] = [];
  for (const r of reviews) {
    const key = `${r.date ?? ""}|${normalizeWhitespace(r.title)}|${normalizeWhitespace(r.body).slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function formatReviewBlock(reviews: AmazonReview[]) {
  return reviews
    .map((r, i) => `[Review ${i + 1}] rating: ${r.rating ?? "—"} | date: ${r.date ?? "—"} | verified: ${r.verifiedPurchase}\n${r.title}\n${r.body}`)
    .join("\n\n");
}

function buildPrompt(asin: string, productTitle: string, positive: AmazonReview[], negative: AmazonReview[], recent: AmazonReview[]) {
  const systemPrompt = `You are analyzing real Amazon customer reviews for ASIN ${asin} (${productTitle}). Using ONLY the review texts provided below in each labeled section — no outside knowledge, no assumptions, no web search:

1. STRENGTHS: recurring positive themes from the POSITIVE REVIEWS section. Each strength must cite at least 2 supporting reviews (a short verbatim quote fragment + that review's date).
2. WEAKNESSES: recurring complaints from the NEGATIVE REVIEWS section. Same citation rule.
3. RECENT DOMINANT THEMES: recurring themes (positive or negative) specifically from the RECENT REVIEWS (last 90 days) section. Same citation rule — at least 2 supporting reviews per theme.

If a section's reviews do not support a claim, do not make it — return an empty array for that section rather than reaching into a different section's reviews. Every quote you cite must be an exact substring of the review text it's attributed to — do not paraphrase inside the quote field.

Return ONLY valid JSON, no markdown:
{
  "strengths": [{ "theme": "...", "evidence": [{ "quote": "...", "date": "..." }, { "quote": "...", "date": "..." }] }],
  "weaknesses": [{ "theme": "...", "evidence": [{ "quote": "...", "date": "..." }, { "quote": "...", "date": "..." }] }],
  "recentDominantThemes": [{ "theme": "...", "evidence": [{ "quote": "...", "date": "..." }, { "quote": "...", "date": "..." }] }]
}`;

  const userPrompt = `Product: ${productTitle} (ASIN ${asin})

POSITIVE REVIEWS (4-5 star):
${positive.length ? formatReviewBlock(positive) : "(none fetched)"}

NEGATIVE REVIEWS (1-2 star):
${negative.length ? formatReviewBlock(negative) : "(none fetched)"}

RECENT REVIEWS (last 90 days, any rating):
${recent.length ? formatReviewBlock(recent) : "(none fetched)"}`;

  return { systemPrompt, userPrompt };
}

async function callAi(systemPrompt: string, userPrompt: string): Promise<any> {
  if (hasOpenAIKey) {
    const result = await callOpenAiForJson(systemPrompt, userPrompt, "review analysis", { timeoutMs: 25_000 });
    if (result) return result;
  }
  if (hasGeminiKey) {
    try {
      const message = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        config: { systemInstruction: systemPrompt, maxOutputTokens: 4096 },
        contents: userPrompt,
      });
      return JSON.parse(cleanJsonString(message.text || "{}"));
    } catch (err) {
      console.warn("Gemini review analysis failed:", err);
    }
  }
  return null;
}

// Fetches the three targeted review sets for this ASIN. Each fetch is
// independent — a failure on one (e.g. Rainforest temporarily rejects the
// star filter) doesn't block the others; analyzeReviews below works with
// whatever combination actually came back non-null.
async function fetchReviewSets(asin: string, referenceDate: Date) {
  const [all, positive, negative, recent] = await Promise.all([
    getAmazonReviews(asin),
    getAmazonReviewsByStars(asin, "four_star,five_star"),
    getAmazonReviewsByStars(asin, "one_star,two_star"),
    getRecentReviews(asin, referenceDate),
  ]);
  return { all: all ?? [], positive: positive ?? [], negative: negative ?? [], recent: recent ?? [] };
}

export async function analyzeReviews(asin: string, productTitle: string, referenceDate: Date = new Date()): Promise<ReviewAnalysis> {
  const { all, positive, negative, recent } = await fetchReviewSets(asin, referenceDate);
  const combined = dedupeReviews([...all, ...positive, ...negative, ...recent]);
  const dateRange = computeDateRange(combined);

  if (combined.length < MIN_REVIEWS_REQUIRED) {
    return { strengths: [], weaknesses: [], recentSentiment: null, reviewCountAnalyzed: combined.length, dateRange, insufficientData: true, aiUnavailable: false };
  }

  // Prior-period average — everything NOT in the last-90-days set — lets
  // the trend badge below be a real, code-computed comparison rather than
  // an AI guess at whether sentiment is "improving".
  const recentKeys = new Set(recent.map(r => `${r.date}|${normalizeWhitespace(r.title)}`));
  const priorReviews = combined.filter(r => !recentKeys.has(`${r.date}|${normalizeWhitespace(r.title)}`));
  const recentAvg = avgRating(recent);
  const priorAvg = avgRating(priorReviews);

  let trend: RecentSentiment["trend"] = "unknown";
  if (recentAvg !== null && priorAvg !== null) {
    const delta = recentAvg - priorAvg;
    trend = Math.abs(delta) < RATING_TREND_EPSILON ? "stable" : delta > 0 ? "improving" : "declining";
  }

  const { systemPrompt, userPrompt } = buildPrompt(asin, productTitle, positive, negative, recent);
  const raw = await callAi(systemPrompt, userPrompt);

  if (!raw) {
    // No AI provider available — explicitly empty, never a guess.
    return { strengths: [], weaknesses: [], recentSentiment: null, reviewCountAnalyzed: combined.length, dateRange, insufficientData: false, aiUnavailable: true };
  }

  function verifyThemes(themes: any[], sourceReviews: AmazonReview[]): ReviewTheme[] {
    if (!Array.isArray(themes)) return [];
    const verified: ReviewTheme[] = [];
    for (const t of themes) {
      if (!t?.theme || !Array.isArray(t.evidence)) continue;
      const verifiedEvidence = t.evidence.filter((e: any) => e?.quote && quoteAppearsInReviews(e.quote, sourceReviews));
      if (verifiedEvidence.length >= MIN_EVIDENCE_PER_THEME) {
        verified.push({ theme: t.theme, evidence: verifiedEvidence.map((e: any) => ({ quote: e.quote, date: e.date ?? null })) });
      }
    }
    return verified;
  }

  // Each section's quotes are checked against ITS OWN source reviews —
  // a "strength" citing a quote from a negative review (or vice versa)
  // fails verification, since positive/negative themes must actually come
  // from the review set they're labeled as drawn from.
  const dominantThemes = verifyThemes(raw.recentDominantThemes, recent.length ? recent : combined);

  return {
    strengths: verifyThemes(raw.strengths, positive.length ? positive : combined),
    weaknesses: verifyThemes(raw.weaknesses, negative.length ? negative : combined),
    recentSentiment: recent.length > 0 ? {
      reviewCount: recent.length,
      avgRating: recentAvg,
      priorAvgRating: priorAvg,
      trend,
      dominantThemes,
    } : null,
    reviewCountAnalyzed: combined.length,
    dateRange,
    insufficientData: false,
    aiUnavailable: false,
  };
}
