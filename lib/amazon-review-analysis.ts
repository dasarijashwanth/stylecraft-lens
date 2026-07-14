// Strictly review-grounded strengths/weaknesses/recent-sentiment analysis.
// The AI only ever sees the review/article texts fetched for THIS product —
// never web search results trusted blindly, never its own trained
// knowledge. After it responds, every quoted fragment is verified to
// actually appear in the fetched text; any theme whose evidence doesn't
// verify is dropped before it ever reaches the UI. This makes
// hallucination structurally impossible to reach the client.
//
// Amazon reviews are one source, not the only one: when Amazon has fewer
// than MIN_REVIEWS_REQUIRED reviews (no ASIN, sparse listing, or the
// reviews endpoint is down — a real, observed Rainforest outage), this
// falls through to expert review articles and forum discussions found via
// web search, fetched and verified the same way.
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { callOpenAiForJson, hasOpenAIKey } from "./openai";
import { AmazonReview, getAmazonReviews, getAmazonReviewsByStars, getRecentReviews } from "./rainforest";
import { searchForUrls } from "./web-search";
import { fetchPageText, quoteAppearsInText } from "./citations";

export type ReviewSourceType = "customer_reviews" | "expert_review" | "forum";

export interface ReviewEvidence {
  quote: string;
  date: string | null;
}

export interface ReviewTheme {
  theme: string;
  evidence: ReviewEvidence[];
  sourceType: ReviewSourceType;
  sourceUrl?: string | null;
}

export interface RecentSentiment {
  reviewCount: number;
  avgRating: number | null;
  priorAvgRating: number | null;
  // Computed in code from the actual numbers above — never AI-guessed.
  trend: "improving" | "declining" | "stable" | "unknown";
  dominantThemes: ReviewTheme[];
}

export interface SourcesSummary {
  amazonReviews: number;
  expertReviews: number;
  forumDiscussions: number;
  tiersTried: string[];
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
  // insufficientData, which means no source (Amazon or web) had anything.
  aiUnavailable: boolean;
  sourcesSummary: SourcesSummary;
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

// Fetches the three targeted Amazon review sets for this ASIN. Each fetch
// is independent — a failure on one (e.g. Rainforest temporarily rejects
// the star filter, or the reviews endpoint is down entirely) doesn't block
// the others; analyzeReviews works with whatever combination came back.
async function fetchAmazonReviewSets(asin: string, referenceDate: Date) {
  const [all, positive, negative, recent] = await Promise.all([
    getAmazonReviews(asin),
    getAmazonReviewsByStars(asin, "four_star,five_star"),
    getAmazonReviewsByStars(asin, "one_star,two_star"),
    getRecentReviews(asin, referenceDate),
  ]);
  return { all: all ?? [], positive: positive ?? [], negative: negative ?? [], recent: recent ?? [] };
}

// Web fallback tier — expert review articles + forum discussions, fetched
// and verified the same way as Amazon reviews (quote must be a real
// substring of the actual fetched page). Runs only when Amazon didn't
// provide enough reviews on its own.
// Confirmed live: extracting strengths+weaknesses from a full ~20k-char
// article at effort:"low" routinely exceeds 20s and hits the OpenAI client
// timeout — bumped alongside the text-window increase above.
const WEB_REVIEW_TIMEOUT_MS = 35_000;

async function resolveWebReviewThemes(productName: string): Promise<{
  strengths: ReviewTheme[];
  weaknesses: ReviewTheme[];
  expertReviewCount: number;
  forumCount: number;
}> {
  const [expertHits, forumHits] = await Promise.all([
    searchForUrls(`"${productName}" review pros and cons`, 3),
    searchForUrls(`"${productName}" reddit`, 2),
  ]);

  const strengths: ReviewTheme[] = [];
  const weaknesses: ReviewTheme[] = [];
  let expertReviewCount = 0;
  let forumCount = 0;

  const processHit = async (url: string, sourceType: ReviewSourceType) => {
    const text = await fetchPageText(url);
    if (!text || text.length < 100) return;

    const result = await callOpenAiForJson<{ strengths: any[]; weaknesses: any[] }>(
      `From the text below about "${productName}", list recurring strengths and weaknesses mentioned. Using ONLY this text — no outside knowledge. Each theme needs at least 2 verbatim quote fragments from the text. If the text isn't really about this product, or doesn't support a theme, omit it.

Return ONLY valid JSON: { "strengths": [{ "theme": "...", "evidence": [{ "quote": "..." }, { "quote": "..." }] }], "weaknesses": [...] }`,
      // Real review content is often preceded by several thousand
      // characters of nav/membership/ad boilerplate — confirmed live
      // against real review pages (lib/key-features-resolver.ts hit the
      // same issue) that a small window reliably missed it.
      `Text:\n${text.slice(0, 20_000)}`,
      `web review themes (${sourceType})`,
      { timeoutMs: WEB_REVIEW_TIMEOUT_MS }
    );
    if (!result) return;

    const verify = (themes: any[]): ReviewTheme[] => {
      if (!Array.isArray(themes)) return [];
      const out: ReviewTheme[] = [];
      for (const t of themes) {
        if (!t?.theme || !Array.isArray(t.evidence)) continue;
        const verifiedEvidence = t.evidence.filter((e: any) => e?.quote && quoteAppearsInText(e.quote, [text]));
        if (verifiedEvidence.length >= MIN_EVIDENCE_PER_THEME) {
          out.push({ theme: t.theme, evidence: verifiedEvidence.map((e: any) => ({ quote: e.quote, date: null })), sourceType, sourceUrl: url });
        }
      }
      return out;
    };

    const s = verify(result.strengths);
    const w = verify(result.weaknesses);
    if (s.length || w.length) {
      if (sourceType === "expert_review") expertReviewCount++;
      else forumCount++;
    }
    strengths.push(...s);
    weaknesses.push(...w);
  };

  await Promise.all([
    ...expertHits.map(h => processHit(h.url, "expert_review" as ReviewSourceType)),
    ...forumHits.map(h => processHit(h.url, "forum" as ReviewSourceType)),
  ]);

  return { strengths, weaknesses, expertReviewCount, forumCount };
}

export async function analyzeReviews(asin: string, productTitle: string, referenceDate: Date = new Date()): Promise<ReviewAnalysis> {
  const tiersTried: string[] = ["Amazon reviews"];
  const { all, positive, negative, recent } = await fetchAmazonReviewSets(asin, referenceDate);
  const combined = dedupeReviews([...all, ...positive, ...negative, ...recent]);
  const dateRange = computeDateRange(combined);

  const amazonSufficient = combined.length >= MIN_REVIEWS_REQUIRED;

  let strengths: ReviewTheme[] = [];
  let weaknesses: ReviewTheme[] = [];
  let recentSentiment: RecentSentiment | null = null;
  let expertReviewCount = 0;
  let forumCount = 0;
  let anyAiUnavailable = false;

  if (amazonSufficient) {
    // Prior-period average — everything NOT in the last-90-days set — lets
    // the trend badge below be a real, code-computed comparison rather
    // than an AI guess at whether sentiment is "improving".
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
      anyAiUnavailable = true;
    } else {
      const verifyThemes = (themes: any[], sourceReviews: AmazonReview[]): ReviewTheme[] => {
        if (!Array.isArray(themes)) return [];
        const out: ReviewTheme[] = [];
        for (const t of themes) {
          if (!t?.theme || !Array.isArray(t.evidence)) continue;
          const verifiedEvidence = t.evidence.filter((e: any) => e?.quote && quoteAppearsInReviews(e.quote, sourceReviews));
          if (verifiedEvidence.length >= MIN_EVIDENCE_PER_THEME) {
            out.push({
              theme: t.theme,
              evidence: verifiedEvidence.map((e: any) => ({ quote: e.quote, date: e.date ?? null })),
              sourceType: "customer_reviews",
            });
          }
        }
        return out;
      };

      strengths = verifyThemes(raw.strengths, positive.length ? positive : combined);
      weaknesses = verifyThemes(raw.weaknesses, negative.length ? negative : combined);
      const dominantThemes = verifyThemes(raw.recentDominantThemes, recent.length ? recent : combined);

      recentSentiment = recent.length > 0 ? {
        reviewCount: recent.length,
        avgRating: recentAvg,
        priorAvgRating: priorAvg,
        trend,
        dominantThemes,
      } : null;
    }
  } else {
    // Amazon alone isn't enough — fall through to expert reviews + forum
    // discussions found via web search, verified the same independent way.
    tiersTried.push("Expert reviews", "Forum discussions");
    const web = await resolveWebReviewThemes(productTitle);
    strengths = web.strengths;
    weaknesses = web.weaknesses;
    expertReviewCount = web.expertReviewCount;
    forumCount = web.forumCount;
  }

  const totalThemesFound = strengths.length + weaknesses.length + (recentSentiment?.dominantThemes.length ?? 0);
  const noDataAnywhere = combined.length === 0 && expertReviewCount === 0 && forumCount === 0;

  return {
    strengths,
    weaknesses,
    recentSentiment,
    reviewCountAnalyzed: combined.length,
    dateRange,
    insufficientData: noDataAnywhere || (combined.length < MIN_REVIEWS_REQUIRED && totalThemesFound === 0 && expertReviewCount === 0 && forumCount === 0),
    aiUnavailable: anyAiUnavailable && totalThemesFound === 0,
    sourcesSummary: {
      amazonReviews: combined.length,
      expertReviews: expertReviewCount,
      forumDiscussions: forumCount,
      tiersTried,
    },
  };
}
