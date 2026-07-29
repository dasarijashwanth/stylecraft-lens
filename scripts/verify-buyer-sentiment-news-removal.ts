// scripts/verify-buyer-sentiment-news-removal.ts
// Offline regression check for the buyer_sentiment_enabled/news_updates_enabled
// feature flags — proves:
//   1. Both flags default to enabled (fail-open) with no special setup.
//   2. Disabling sentiment skips the extra last-90-days Rainforest call
//      entirely (the real, measurable savings) while leaving the Strengths/
//      Weaknesses-feeding star-filtered fetches completely unaffected.
//   3. The response-masking helper (maskSentimentForResponse) hides
//      recentSentiment without ever mutating the underlying object — the
//      mechanism that makes "hide, don't delete" + instant restore-on-
//      reflip work in app/api/amazon/reviews-analysis/[asin]/route.ts.
//   4. Both API routes still gate their expensive call (analyzeReviews's
//      AI/Rainforest work, findProductNews's OpenAI web_search) behind
//      their flag check via static source inspection — Next.js route
//      handlers need a real request context (cookies/headers) that isn't
//      available in a plain offline script, so this is checked the same
//      way this repo already checks phase/label contracts elsewhere
//      (scripts/verify-phase-sequence-contract.ts), not by invoking the
//      handler.
//
// No live Rainforest/OpenAI/Gemini calls — globalThis.fetch is replaced
// entirely before anything is imported, and no OPENAI_API_KEY/GEMINI
// key is set, so every AI call short-circuits to "unavailable" exactly
// like scripts/verify-review-tiers.ts already documents.
//
// Run with: npx tsx scripts/verify-buyer-sentiment-news-removal.ts

export {};

import { readFileSync } from "fs";
import { resolve } from "path";

process.env.RAINFOREST_API_KEY = "test-key-not-a-real-credential";

let failures = 0;
let passes = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passes++;
    console.log(`  PASS: ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const SAMPLE_REVIEWS = [
  { title: "Great", body: "This works great every single day and I love it a lot.", rating: 5, date: { utc: todayIso() }, verified_purchase: true },
  { title: "Good", body: "Solid build quality and it feels very reliable overall.", rating: 4, date: { utc: todayIso() }, verified_purchase: true },
  { title: "Nice", body: "Works exactly as expected, no complaints at all here.", rating: 5, date: { utc: todayIso() }, verified_purchase: true },
  { title: "OK", body: "Does the job fine, nothing special but fine for the price.", rating: 4, date: { utc: todayIso() }, verified_purchase: false },
  { title: "Happy", body: "Very happy with this purchase and would buy again soon.", rating: 5, date: { utc: todayIso() }, verified_purchase: true },
];

let noStarsCallCount = 0;
let starsCallCount = 0;

(globalThis as any).fetch = async (input: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.includes("rainforestapi.com")) {
    return new Response("{}", { status: 500 }); // fail closed — nothing else should be reachable
  }
  const u = new URL(url);
  if (u.searchParams.get("type") !== "reviews") return new Response("{}", { status: 500 });
  if (u.searchParams.get("review_stars")) starsCallCount++; else noStarsCallCount++;
  return new Response(JSON.stringify({ request_info: { success: true }, reviews: SAMPLE_REVIEWS }), { status: 200 });
};

async function main() {
  const featureFlags = await import("../lib/feature-flags");
  const dbFeatureFlags = await import("../lib/db/feature-flags");
  const reviewAnalysis = await import("../lib/amazon-review-analysis");

  console.log("\n[1] Flags default to enabled with no special setup");
  assert(await featureFlags.isBuyerSentimentEnabled() === true, "isBuyerSentimentEnabled() defaults to true");
  assert(await featureFlags.isNewsUpdatesEnabled() === true, "isNewsUpdatesEnabled() defaults to true");
  await dbFeatureFlags.setFeatureFlag("buyer_sentiment_enabled", false);
  assert(await featureFlags.isBuyerSentimentEnabled() === false, "isBuyerSentimentEnabled() reflects a disable immediately");
  await dbFeatureFlags.setFeatureFlag("buyer_sentiment_enabled", true);
  assert(await featureFlags.isBuyerSentimentEnabled() === true, "isBuyerSentimentEnabled() reflects a re-enable immediately (no regeneration needed)");

  const FAKE_ASIN = "B0FAKETEST";

  console.log("\n[2] includeSentiment:false skips the last-90-days Rainforest pass entirely");
  noStarsCallCount = 0; starsCallCount = 0;
  const withoutSentiment = await reviewAnalysis.analyzeReviews(FAKE_ASIN, "Test Product", new Date(), null, null, { includeSentiment: false });
  assert(noStarsCallCount === 2, `exactly 2 no-star-filter Rainforest calls (the base "all reviews" fetch only, no last-90-days pass) — got ${noStarsCallCount}`);
  assert(starsCallCount === 4, `the 2 star-filtered fetches (positive/negative, 2 pages each) that feed Strengths/Weaknesses still ran normally — got ${starsCallCount}`);
  assert(withoutSentiment.recentSentiment === null, "recentSentiment is null when includeSentiment:false");

  console.log("\n[3] includeSentiment defaulting to true still runs the last-90-days pass");
  noStarsCallCount = 0; starsCallCount = 0;
  const withSentiment = await reviewAnalysis.analyzeReviews(FAKE_ASIN, "Test Product", new Date());
  assert(noStarsCallCount === 7, `7 no-star-filter calls (2 from "all" + 5 from the last-90-days pass, which never breaks early since every mocked review is dated today) — got ${noStarsCallCount}`);
  assert(starsCallCount === 4, `the same 4 star-filtered calls run regardless — got ${starsCallCount}`);
  // No OpenAI/Gemini key is set in this offline script, so recentSentiment
  // stays null here too (AI unavailable) — this does NOT contradict item 2;
  // it just means this specific assertion can't distinguish "skipped by the
  // flag" from "skipped because no theme AI ran" without a live AI call,
  // which this script must never make. The call-count assertions above are
  // the real, unambiguous proof of the savings.
  assert(withoutSentiment.strengths.length === 0 && withSentiment.strengths.length === 0, "strengths stay identically empty in both scenarios (no AI key) — includeSentiment never changes Strengths' shape");
  assert(withoutSentiment.weaknesses.length === 0 && withSentiment.weaknesses.length === 0, "weaknesses stay identically empty in both scenarios (no AI key) — includeSentiment never changes Weaknesses' shape");

  console.log("\n[4] maskSentimentForResponse hides recentSentiment without mutating the source object");
  const fakeStoredAnalysis: any = {
    strengths: [], weaknesses: [],
    recentSentiment: { reviewCount: 12, avgRating: 4.5, priorAvgRating: 4.1, trend: "improving", dominantThemes: [] },
  };
  const maskedOff = reviewAnalysis.maskSentimentForResponse(fakeStoredAnalysis, false);
  assert(maskedOff.recentSentiment === null, "masked response has recentSentiment: null when the flag is off");
  assert(fakeStoredAnalysis.recentSentiment !== null, "the underlying stored object is NOT mutated — still carries its real sentiment data");
  assert(maskedOff !== fakeStoredAnalysis, "masking returns a new object, never the same reference, when hiding");
  const maskedOn = reviewAnalysis.maskSentimentForResponse(fakeStoredAnalysis, true);
  assert(maskedOn.recentSentiment === fakeStoredAnalysis.recentSentiment, "masking is a no-op (same data) when the flag is on — old cached sentiment reappears instantly, no regeneration");

  console.log("\n[5] Both routes gate their expensive call behind the flag (static source check)");
  const reviewsRouteSrc = readFileSync(resolve(process.cwd(), "app/api/amazon/reviews-analysis/[asin]/route.ts"), "utf-8");
  const maskCallCount = (reviewsRouteSrc.match(/maskSentimentForResponse\(/g) || []).length;
  assert(maskCallCount === 2, `reviews-analysis route calls maskSentimentForResponse on both the cache-hit and fresh-compute return paths — found ${maskCallCount} call site(s)`);
  assert(reviewsRouteSrc.includes("includeSentiment: sentimentOn"), "reviews-analysis route passes the flag into analyzeReviews for a fresh compute (skips the Rainforest call, not just the response)");

  const newsRouteSrc = readFileSync(resolve(process.cwd(), "app/api/amazon/product-news/[asin]/route.ts"), "utf-8");
  const guardIdx = newsRouteSrc.indexOf("isNewsUpdatesEnabled()");
  const callIdx = newsRouteSrc.indexOf("findProductNews(");
  assert(guardIdx !== -1 && callIdx !== -1 && guardIdx < callIdx, "product-news route checks isNewsUpdatesEnabled() BEFORE ever calling findProductNews — a disabled flag never spends an OpenAI web_search call");

  console.log(`\n${passes} passed, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

// This script touches lib/db/feature-flags.ts, which always tries Supabase
// first before falling back to memoryDb — same dangling-handle issue noted
// in scripts/verify-phase-sequence-contract.ts. Explicit exit forces a
// clean process end either way.
main().then(() => process.exit(0)).catch(err => {
  console.error("verify-buyer-sentiment-news-removal script failed:", err);
  process.exit(1);
});
