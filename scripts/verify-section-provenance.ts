// scripts/verify-section-provenance.ts
// Offline regression check for the persisted per-section provenance
// feature — proves the section_provenance table's memoryDb fallback works,
// and that each resolver's provenance-building logic is correct, WITHOUT
// ever making a live Rainforest or OpenAI/Gemini call (the account's
// credits are limited for both — this script must never spend one).
//
// How it stays offline: no .env.local is loaded, so isSupabaseConfigured,
// hasOpenAIKey, and hasGeminiKey all resolve false — every module this
// pulls in already degrades gracefully in that state (same as any real
// environment missing those keys), and DB calls fall through to the
// memoryDb branch (no network at all, not even to Supabase).
//
// Run with: npx tsx scripts/verify-section-provenance.ts

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const provenanceDb = await import("../lib/db/section-provenance");
  const { buildPricingProvenanceTier } = await import("../lib/section-provenance");
  const keyFeatures = await import("../lib/key-features-resolver");
  const productNews = await import("../lib/product-news");
  const reviewAnalysis = await import("../lib/amazon-review-analysis");

  // ---- Section 1: memoryDb round-trip (no Supabase configured) ----
  console.log("\n[1] section_provenance memoryDb round-trip");

  await provenanceDb.insertProvenance({
    productKey: "B0TESTKEY1", section: "key_features", productName: "Test Product",
    tiers: [{ tier: "Amazon", attempted: true, outcome: "success", itemCount: 3 }], queries: [],
  });
  await sleep(5); // ensure a distinguishable resolved_at from the first insert
  await provenanceDb.insertProvenance({
    productKey: "B0TESTKEY1", section: "key_features", productName: "Test Product",
    tiers: [{ tier: "Amazon", attempted: true, outcome: "success", itemCount: 5 }], queries: [],
  });
  const latestKF = await provenanceDb.getLatestProvenance("B0TESTKEY1", "key_features");
  assert(latestKF?.tiers[0]?.itemCount === 5, "getLatestProvenance returns the most recently inserted row, not the first");

  await provenanceDb.insertProvenance({
    productKey: "B0TESTKEY1", section: "reviews", productName: "Test Product",
    tiers: [{ tier: "Amazon reviews", attempted: true, outcome: "success", itemCount: 12 }], queries: [],
  });
  const allLatest = await provenanceDb.getAllLatestProvenance("B0TESTKEY1");
  assert(Object.keys(allLatest).sort().join(",") === "key_features,reviews", "getAllLatestProvenance returns exactly one row per distinct section");

  // ---- Section 2: key-features resolver ----
  console.log("\n[2] key-features-resolver provenance");

  const shortTextResult = await keyFeatures.extractFeaturesFromText("Test Product", "short", "Brand site", "https://example.com", "Example");
  assert(shortTextResult.features.length === 0 && shortTextResult.rejectedCount === 1 && shortTextResult.rejectedReasons.length === 1, "extractFeaturesFromText rejects text under 50 chars with a populated reason");

  const kfResult = await keyFeatures.resolveKeyFeatures("Totally Fictional Product Xyzzy", null);
  const amazonTier = kfResult.provenance?.tiers.find(t => t.tier === "Amazon");
  assert(amazonTier?.attempted === false && amazonTier?.outcome === "skipped", "Amazon tier reports attempted:false, outcome:'skipped' when no ASIN is available");
  const brandTier = kfResult.provenance?.tiers.find(t => t.tier === "Brand site");
  assert(brandTier?.attempted === true && brandTier?.outcome === "empty", "Brand site tier is genuinely attempted (not skipped) even though no OpenAI key means zero hits");
  assert(kfResult.provenance!.queries.every(q => q.verified === true), "every key-features query is marked verified (code-checked, not self-reported)");

  // ---- Section 3: news resolver ----
  console.log("\n[3] product-news excluded-sources parsing + provenance");

  const withExclusions = "StyleCraft Trimmer got a great review on Site A.\n\nExcluded sources:\nGeneral clipper roundup on Site B - about the category, not this exact product\nBrand press release - about the brand in general";
  const parsed = productNews.parseExcludedSources(withExclusions);
  assert(parsed.rejectedCount === 2 && parsed.rejectedReasons.length === 2, "parseExcludedSources extracts both excluded-source lines with reasons");
  assert(parsed.markerIndex < withExclusions.length && parsed.markerIndex > 0, "parseExcludedSources finds the marker before the excluded-sources tail");

  const noExclusions = "StyleCraft Trimmer got a great review on Site A.\n\nExcluded sources: none";
  const parsedNone = productNews.parseExcludedSources(noExclusions);
  assert(parsedNone.rejectedCount === 0, "parseExcludedSources treats 'Excluded sources: none' as zero rejections");

  const newsResult = await productNews.findProductNews("Totally Fictional Product Xyzzy", null);
  assert(newsResult.provenance?.tiers[0]?.attempted === false && newsResult.provenance?.tiers[0]?.outcome === "skipped", "news tier reports attempted:false, outcome:'skipped' when OpenAI isn't configured");

  // ---- Section 4: pricing ----
  console.log("\n[4] pricing provenance");

  const pricedTier = buildPricingProvenanceTier({ price_raw: 199.99, amazon_url: "https://amazon.com/dp/B0FAKE00001" });
  assert(pricedTier.outcome === "success" && pricedTier.itemCount === 1, "buildPricingProvenanceTier reports success+1 for a priced competitor");
  const unpricedTier = buildPricingProvenanceTier({ price_raw: null, price: "—" });
  assert(unpricedTier.outcome === "empty" && unpricedTier.itemCount === 0, "buildPricingProvenanceTier reports empty+0 for an unpriced competitor");

  // ---- Section 5: reviews resolver's provenance (unattempted -> skipped) ----
  console.log("\n[5] amazon-review-analysis provenance mapping");

  const reviewResult = await reviewAnalysis.analyzeReviews("", "Totally Fictional Product Xyzzy", new Date());
  const reviewsTier = reviewResult.provenance?.tiers.find(t => t.tier === "Amazon reviews");
  assert(reviewsTier?.attempted === false && reviewsTier?.outcome === "skipped", "fromTierResult maps an unattempted Amazon reviews tier to outcome:'skipped'");
  const listingTier = reviewResult.provenance?.tiers.find(t => t.tier === "Amazon listing (top reviews)");
  assert(listingTier?.attempted === false && listingTier?.outcome === "skipped", "Tier B (no product payload given) is also reported as skipped");

  // ---- Section 6: cross-cutting verified invariant ----
  // Note: findProductNews short-circuits before OpenAI is ever called when
  // no key is configured (the offline-safe path exercised in [3] above),
  // so its self-reported "verified:false" query literal is only produced on
  // a real successful call — not reachable here without an actual OpenAI
  // request, which this script must never make. What IS fully verifiable
  // offline: every query this run's code paths (key-features, reviews,
  // news-with-no-key) actually produced is coded-verified, never
  // self-reported — i.e. verified:false never appears where it shouldn't.
  console.log("\n[6] cross-cutting: verified:false never appears outside News's self-reported exclusions");

  const allQueries = [
    ...kfResult.provenance!.queries,
    ...newsResult.provenance!.queries,
  ];
  assert(allQueries.every(q => q.verified === true), "every query actually produced in this offline run (key-features + news-with-no-key) is verified:true — verified:false is reserved exclusively for News's self-reported exclusions (see lib/product-news.ts's excludedQuery literal)");

  console.log(`\n${passes} passed, ${failures} failed.`);
  // lib/memoryDb.ts starts an un-ref'd setInterval autosave timer as soon as
  // it's imported (by design, for a long-running local dev server) — this
  // one-shot script must force-exit rather than wait for the event loop to
  // drain naturally, or it hangs forever after printing results.
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("verify-section-provenance script failed:", err);
  process.exit(1);
});
