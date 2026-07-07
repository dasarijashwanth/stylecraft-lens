// Strictly review-grounded strengths/weaknesses/recent-theme analysis.
// The AI only ever sees the review texts fetched for THIS ASIN — never web
// search, never its own trained knowledge. After it responds, every quoted
// fragment is verified to actually appear in the fetched reviews; any theme
// whose evidence doesn't verify is dropped before it ever reaches the UI.
// This makes hallucination structurally impossible to reach the client.
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { anthropic, hasAnthropicKey, ANTHROPIC_MODEL } from "./anthropic";
import { AmazonReview } from "./rainforest";

export interface ReviewEvidence {
  quote: string;
  date: string | null;
}

export interface ReviewTheme {
  theme: string;
  evidence: ReviewEvidence[];
}

export interface ReviewAnalysis {
  strengths: ReviewTheme[];
  weaknesses: ReviewTheme[];
  recentThemes: string[];
  reviewCountAnalyzed: number;
  dateRange: { earliest: string | null; latest: string | null } | null;
  insufficientData: boolean;
}

const MIN_REVIEWS_REQUIRED = 5;
const MIN_EVIDENCE_PER_THEME = 2;

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

function buildPrompt(asin: string, productTitle: string, reviews: AmazonReview[]) {
  const reviewBlock = reviews
    .map((r, i) => `[Review ${i + 1}] rating: ${r.rating ?? "—"} | date: ${r.date ?? "—"} | verified: ${r.verifiedPurchase}\n${r.title}\n${r.body}`)
    .join("\n\n");

  const systemPrompt = `You are analyzing real Amazon customer reviews for ASIN ${asin} (${productTitle}). Using ONLY the review texts provided below — no outside knowledge, no assumptions, no web search:
1. STRENGTHS: recurring positive themes. Each strength must cite at least 2 supporting reviews (a short verbatim quote fragment + that review's date).
2. WEAKNESSES: recurring complaints. Same citation rule.
3. RECENT THEMES: what buyers mention in reviews from the last 90 days (based on the review dates provided), as plain short statements — no citation needed for these.
If the reviews do not support a claim, do not make it. Every quote you cite must be an exact substring of the review text it's attributed to — do not paraphrase inside the quote field.

Return ONLY valid JSON, no markdown:
{
  "strengths": [{ "theme": "...", "evidence": [{ "quote": "...", "date": "..." }, { "quote": "...", "date": "..." }] }],
  "weaknesses": [{ "theme": "...", "evidence": [{ "quote": "...", "date": "..." }, { "quote": "...", "date": "..." }] }],
  "recentThemes": ["..."]
}`;

  const userPrompt = `Reviews for ${productTitle} (ASIN ${asin}):\n\n${reviewBlock}`;
  return { systemPrompt, userPrompt };
}

async function callAi(systemPrompt: string, userPrompt: string): Promise<any> {
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
  if (hasAnthropicKey) {
    try {
      const message = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const text = message.content.filter(b => b.type === "text").map((b: any) => b.text).join("\n");
      return JSON.parse(cleanJsonString(text || "{}"));
    } catch (err) {
      console.warn("Anthropic review analysis failed:", err);
    }
  }
  return null;
}

export async function analyzeReviews(asin: string, productTitle: string, reviews: AmazonReview[]): Promise<ReviewAnalysis> {
  const dateRange = computeDateRange(reviews);

  if (reviews.length < MIN_REVIEWS_REQUIRED) {
    return { strengths: [], weaknesses: [], recentThemes: [], reviewCountAnalyzed: reviews.length, dateRange, insufficientData: true };
  }

  const { systemPrompt, userPrompt } = buildPrompt(asin, productTitle, reviews);
  const raw = await callAi(systemPrompt, userPrompt);

  if (!raw) {
    // No AI provider available — explicitly empty, never a guess.
    return { strengths: [], weaknesses: [], recentThemes: [], reviewCountAnalyzed: reviews.length, dateRange, insufficientData: false };
  }

  function verifyThemes(themes: any[]): ReviewTheme[] {
    if (!Array.isArray(themes)) return [];
    const verified: ReviewTheme[] = [];
    for (const t of themes) {
      if (!t?.theme || !Array.isArray(t.evidence)) continue;
      const verifiedEvidence = t.evidence.filter((e: any) => e?.quote && quoteAppearsInReviews(e.quote, reviews));
      if (verifiedEvidence.length >= MIN_EVIDENCE_PER_THEME) {
        verified.push({ theme: t.theme, evidence: verifiedEvidence.map((e: any) => ({ quote: e.quote, date: e.date ?? null })) });
      }
    }
    return verified;
  }

  return {
    strengths: verifyThemes(raw.strengths),
    weaknesses: verifyThemes(raw.weaknesses),
    recentThemes: Array.isArray(raw.recentThemes) ? raw.recentThemes.filter((t: any) => typeof t === "string") : [],
    reviewCountAnalyzed: reviews.length,
    dateRange,
    insufficientData: false,
  };
}
