// scripts/verify-review-tiers.ts
// Offline regression check for the review-resolution tri-state fix — proves
// the "Rainforest credit/auth outage silently masquerades as no data" bug is
// fixed, and that the product-listing (top_reviews/rating_breakdown)
// fallback tier gives a product with a real Amazon listing a floor, WITHOUT
// ever making a live Rainforest call (the account's credits are limited —
// this script must never spend one).
//
// How it stays offline: no .env.local is loaded, so isSupabaseConfigured
// and hasOpenAIKey/hasGeminiKey are all false — every module this pulls in
// already degrades gracefully in that state (same as any real environment
// missing those keys). globalThis.fetch is replaced entirely (not wrapped)
// before anything is imported, so nothing — Rainforest or otherwise — can
// reach the network; any URL this script doesn't recognize gets a generic
// 500 instead of a real request.
//
// Run with: npx tsx scripts/verify-review-tiers.ts

export {}; // forces module scope so this file's top-level names (assert, main, ...) don't collide with sibling scripts under a whole-project tsc run

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

type Scenario = "reviews_ok" | "reviews_empty" | "reviews_error";
let currentScenario: Scenario = "reviews_ok";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function reviewsPayload(reviews: any[]) {
  return JSON.stringify({ request_info: { success: true }, reviews });
}

const SAMPLE_REVIEWS = [
  { title: "Great", body: "This works great every single day and I love it a lot.", rating: 5, date: { utc: todayIso() }, verified_purchase: true },
  { title: "Good", body: "Solid build quality and it feels very reliable overall.", rating: 4, date: { utc: todayIso() }, verified_purchase: true },
  { title: "Nice", body: "Works exactly as expected, no complaints at all here.", rating: 5, date: { utc: todayIso() }, verified_purchase: true },
  { title: "OK", body: "Does the job fine, nothing special but fine for the price.", rating: 4, date: { utc: todayIso() }, verified_purchase: false },
  { title: "Happy", body: "Very happy with this purchase and would buy again soon.", rating: 5, date: { utc: todayIso() }, verified_purchase: true },
];

(globalThis as any).fetch = async (input: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.includes("rainforestapi.com")) {
    // Defense in depth — nothing in this script should ever reach a
    // non-Rainforest URL (OpenAI/Gemini calls are already short-circuited
    // by the absence of API keys), but fail closed instead of passing
    // through to a real fetch if something unexpected tries to.
    return new Response("{}", { status: 500 });
  }

  const u = new URL(url);
  if (u.searchParams.get("type") !== "reviews") {
    return new Response("{}", { status: 500 });
  }

  if (currentScenario === "reviews_ok") return new Response(reviewsPayload(SAMPLE_REVIEWS), { status: 200 });
  if (currentScenario === "reviews_empty") return new Response(reviewsPayload([]), { status: 200 });
  return new Response("Forbidden", { status: 403 }); // reviews_error
};

async function main() {
  const rainforest = await import("../lib/rainforest");
  const reviewAnalysis = await import("../lib/amazon-review-analysis");

  const FAKE_ASIN = "B0FAKETEST"; // 10 chars, matches the ASIN format regex

  // ---- Section 1: pure unit tests, no fetch involved ----
  console.log("\n[1] combineFetchResults");
  assert(
    rainforest.combineFetchResults([{ status: "error", reviews: [] }, { status: "ok", reviews: [{ title: "a", body: "b", rating: 5, date: null, verifiedPurchase: false }] }]).status === "ok",
    "any 'ok' page wins over an 'error' page"
  );
  assert(
    rainforest.combineFetchResults([{ status: "error", reviews: [] }, { status: "empty", reviews: [] }]).status === "empty",
    "an 'empty' page wins over an 'error' page when nothing succeeded"
  );
  assert(
    rainforest.combineFetchResults([{ status: "error", reviews: [], errorMessage: "boom" }]).status === "error",
    "all-error pages combine to 'error'"
  );

  console.log("\n[2] verifyThemes — quote-verification guardrail");
  const fixtureReviews = [
    { title: "T1", body: "The battery lasts an incredibly long time on one charge.", rating: 5, date: null, verifiedPurchase: true },
    { title: "T2", body: "Battery life is amazing, lasts all week for me easily.", rating: 5, date: null, verifiedPurchase: true },
  ];
  const verifiedThemes = reviewAnalysis.verifyThemes(
    [{ theme: "Long battery life", evidence: [
      { quote: "lasts an incredibly long time", date: null },
      { quote: "Battery life is amazing", date: null },
    ] }],
    fixtureReviews,
    "customer_reviews"
  );
  assert(verifiedThemes.length === 1 && verifiedThemes[0].theme === "Long battery life", "a theme with 2 real verbatim quotes survives verification");

  const fabricatedThemes = reviewAnalysis.verifyThemes(
    [{ theme: "Fabricated claim", evidence: [
      { quote: "this quote does not appear anywhere", date: null },
      { quote: "neither does this one at all", date: null },
    ] }],
    fixtureReviews,
    "customer_reviews"
  );
  assert(fabricatedThemes.length === 0, "a theme whose quotes don't appear in the source reviews is dropped (guardrail holds)");

  const underEvidencedThemes = reviewAnalysis.verifyThemes(
    [{ theme: "Only one real quote", evidence: [
      { quote: "lasts an incredibly long time", date: null },
      { quote: "this one is made up", date: null },
    ] }],
    fixtureReviews,
    "customer_reviews"
  );
  assert(underEvidencedThemes.length === 0, "a theme with only 1 verified quote (below MIN_EVIDENCE_PER_THEME) is dropped");

  console.log("\n[3] topReviewsToAmazonReviews");
  const fakeProductForMapping: any = {
    top_reviews: [
      { title: "Top1", body: "A real featured review body here.", rating: 5, date: todayIso(), verified_purchase: true },
      { title: "Empty", body: "   ", rating: 3, date: null, verified_purchase: false },
    ],
  };
  const mapped = reviewAnalysis.topReviewsToAmazonReviews(fakeProductForMapping);
  assert(mapped.length === 1 && mapped[0].title === "Top1", "topReviewsToAmazonReviews maps top_reviews and drops empty-body entries");

  // ---- Section 2: fetchReviewsPage tri-state via mocked fetch (through getAmazonReviews) ----
  console.log("\n[4] Rainforest reviews tri-state (mocked HTTP, no live calls)");

  currentScenario = "reviews_ok";
  const okResult = await rainforest.getAmazonReviews(FAKE_ASIN);
  assert(okResult.status === "ok" && okResult.reviews.length > 0, "a successful reviews response with reviews yields status 'ok'");

  currentScenario = "reviews_empty";
  const emptyResult = await rainforest.getAmazonReviews(FAKE_ASIN);
  assert(emptyResult.status === "empty" && emptyResult.reviews.length === 0, "a successful reviews response with zero reviews yields status 'empty', not 'error'");

  currentScenario = "reviews_error";
  const errorResult = await rainforest.getAmazonReviews(FAKE_ASIN);
  assert(errorResult.status === "error", "a 403 (credit/auth outage) yields status 'error', not 'empty' — this is the core regression fixed");
  assert(!!errorResult.errorMessage && errorResult.errorMessage.includes("403"), "the error message identifies the HTTP 403 status");

  // ---- Section 3: end-to-end analyzeReviews() terminal-state matrix ----
  // Note: no OpenAI/Gemini key is set in this script, so anyAiUnavailable
  // will be true in every scenario below — that's an expected side effect
  // of running fully offline, not something these assertions check.
  console.log("\n[5] analyzeReviews() terminal-state matrix");

  currentScenario = "reviews_ok";
  const scenarioSufficient = await reviewAnalysis.analyzeReviews(FAKE_ASIN, "Test Product", new Date());
  assert(!scenarioSufficient.insufficientData && !scenarioSufficient.sourcesUnavailable, "sufficient real reviews -> neither insufficientData nor sourcesUnavailable");

  currentScenario = "reviews_empty";
  const scenarioEmpty = await reviewAnalysis.analyzeReviews(FAKE_ASIN, "Test Product", new Date());
  assert(scenarioEmpty.insufficientData && !scenarioEmpty.sourcesUnavailable, "genuinely zero reviews everywhere -> insufficientData true, sourcesUnavailable false");
  assert(scenarioEmpty.sourcesSummary.tiers.every(t => t.outcome !== "error"), "no tier is reported as errored when nothing actually failed");

  currentScenario = "reviews_error";
  const scenarioError = await reviewAnalysis.analyzeReviews(FAKE_ASIN, "Test Product", new Date());
  assert(!scenarioError.insufficientData && scenarioError.sourcesUnavailable, "a 403 outage -> sourcesUnavailable true, insufficientData false (never claims 'no data' for a real failure)");
  const erroredTier = scenarioError.sourcesSummary.tiers.find(t => t.tier === "Amazon reviews");
  assert(erroredTier?.attempted === true && erroredTier?.outcome === "error", "the 'Amazon reviews' tier is reported attempted+errored, distinguishable from 'returned 0'");

  const fakeProductWithListing: any = {
    asin: FAKE_ASIN,
    rating: 4.6,
    reviews_total: 12410,
    rating_breakdown: { five_star: 78, four_star: 12, three_star: 5, two_star: 3, one_star: 2 },
    top_reviews: [
      { title: "Featured", body: "This listing-level review body is long enough to use.", rating: 5, date: todayIso(), verified_purchase: true },
    ],
  };
  const scenarioListingFloor = await reviewAnalysis.analyzeReviews(FAKE_ASIN, "Test Product", new Date(), fakeProductWithListing);
  assert(!scenarioListingFloor.insufficientData && !scenarioListingFloor.sourcesUnavailable, "a 403 outage with a real product listing -> neither notice fires (the listing floor covers it)");
  assert(scenarioListingFloor.listingStats?.rating === 4.6 && scenarioListingFloor.listingStats?.reviewsTotal === 12410, "listingStats is populated verbatim from the product payload");
  const tierB = scenarioListingFloor.sourcesSummary.tiers.find(t => t.tier === "Amazon listing (top reviews)");
  assert(tierB?.attempted === true, "the product-listing fallback tier (Tier B) is attempted when Tier A found nothing");

  console.log(`\n${passes} passed, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("verify-review-tiers script failed:", err);
  process.exit(1);
});
