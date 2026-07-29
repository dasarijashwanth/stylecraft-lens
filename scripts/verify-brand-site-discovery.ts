// scripts/verify-brand-site-discovery.ts
// Regression tests A and B (per the Motor+Price-Led Discovery plan's
// Phase F):
//
// [A] A curated brand whose only motor-matched, in-band product is NOT on
//     Amazon is discovered via its official website, selected, and flows
//     cleanly through pricing analysis with a "not on Amazon" empty state
//     — never an error, never a silently-blank cell.
// [B] Research order — no competitor is ever selected without motor
//     evidence when a same-or-better verified candidate could still fill
//     the slot; a confirmed wrong-motor product is only ever a last-resort,
//     explicitly-tagged pick, never preferred over a verified one.
//
// globalThis.fetch is stubbed for THREE hosts before anything is imported
// (same "replace fetch entirely up front" pattern as
// scripts/verify-legacy-brand-discovery.ts): api.openai.com (the brand-site
// web-search call), rainforestapi.com (the concurrent Amazon leg — stubbed
// to return nothing in-band, proving the brand-site path alone can carry a
// competitor), and example.com (the brand's own "official site" — a real,
// stable, publicly-resolvable test domain; lib/safe-fetch.ts's SSRF guard
// does a genuine DNS lookup for whatever hostname is used, so a fabricated
// domain would fail resolution — example.com is IANA-reserved specifically
// for this kind of test and resolves quickly with no real content risk).
// Zero live OpenAI/Gemini/Rainforest calls are made — every response for
// those two hosts is this script's own fixture data.
//
// Run with: npx tsx scripts/verify-brand-site-discovery.ts

export {};

process.env.OPENAI_API_KEY = "test-key-not-a-real-credential";
process.env.RAINFOREST_API_KEY = "test-key-not-a-real-credential";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.log(`FAIL: ${message}`);
    failed++;
  }
}

const PRODUCT_PAGE_HTML = `<!DOCTYPE html><html><head>
  <title>TestBrand Vector Pro Trimmer</title>
  <script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "TestBrand Vector Pro Trimmer", brand: "TestBrand",
    description: "Professional trimmer powered by a high-torque Vector motor for precision line-ups.",
    offers: { price: "229.00", priceCurrency: "USD" },
  })}</script>
</head><body>
  <p>The TestBrand Vector Pro Trimmer uses a Vector motor for maximum torque and precision.</p>
</body></html>`;

(globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";

  if (url.includes("rainforestapi.com")) {
    // Amazon leg finds nothing in-band — proves the brand-site path alone
    // can carry this competitor end to end.
    return new Response(JSON.stringify({ search_results: [] }), { status: 200 });
  }

  if (url.includes("api.openai.com")) {
    // The brand-site web-search call — returns exactly one candidate URL,
    // on the registered domain. Content-Type is required — without it the
    // OpenAI SDK's own response parser treats the body as raw text instead
    // of JSON and throws before this code ever sees the result.
    return new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ urls: ["https://example.com/products/vector-pro-trimmer"] }), annotations: [] }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (url.includes("example.com")) {
    return new Response(PRODUCT_PAGE_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
  }

  return new Response("{}", { status: 500 });
};

const TARGET_PRICE = 259.95;

function makeBrand(): any {
  return {
    id: "brand_testbrand",
    category_id: "cat_test",
    brand_name: "TestBrand",
    aliases: [],
    official_domains: ["example.com"],
    enabled: true,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const { attemptBrandSite, discoverBrandSiteCandidates } = await import("../lib/brand-site-discovery");
  const { searchCuratedLegacyBrands } = await import("../lib/legacy-brand-discovery");
  const { selectByCompositeScore } = await import("../lib/analysisEngine");
  const { buildPricingAnalysis } = await import("../lib/pricing-analysis");
  const { listMotorFamilies } = await import("../lib/db/motor-families");

  const brand = makeBrand();
  const identity: any = { category: "Trimmers", subcategory: "Professional Trimmer", toolType: "trimmer" };

  console.log("\n[A.1] attemptBrandSite — finds a real, motor-evidenced product page on the registered domain");
  {
    const result = await attemptBrandSite(brand, { toolType: "trimmer", motorLabel: "Vector" });
    assert(!!result, "a result was returned (not null)");
    assert(result?.url === "https://example.com/products/vector-pro-trimmer", `the URL is the one actually found on the registered domain (got ${result?.url})`);
    assert(!!result?.price && result.price_raw === 229, `a real MSRP was extracted from the page (got ${result?.price} / ${result?.price_raw})`);
    assert(!!result?.description && /vector/i.test(result.description), "the folded description contains real motor-evidence text (\"Vector\")");
  }

  console.log("\n[A.2] discoverBrandSiteCandidates — same result, via the concurrency-batched entry point");
  {
    const map = await discoverBrandSiteCandidates([brand], { toolType: "trimmer", motorLabel: "Vector" });
    assert(map.has("TestBrand"), "the brand appears in the result map");
    assert(map.get("TestBrand")?.price_raw === 229, "the cached/batched path returns the same real price");
  }

  console.log("\n[A.3] searchCuratedLegacyBrands — the merged candidate is brand-site-sourced, Amazon is genuinely absent");
  let hybridCandidate: any;
  {
    const candidates = await searchCuratedLegacyBrands(
      [brand], identity, TARGET_PRICE, "legacy_professional_clippers", undefined, undefined, "Vector"
    );
    assert(candidates.length === 1, `exactly one candidate was produced (got ${candidates.length})`);
    hybridCandidate = candidates[0];
    assert(hybridCandidate?.sources?.brand_site != null, "sources.brand_site is populated");
    assert(hybridCandidate?.sources?.amazon == null, "sources.amazon is null — genuinely not found on Amazon, not just unattempted");
    assert(hybridCandidate?.asin === "", "asin is empty (no Amazon listing) rather than a fabricated placeholder");
    assert(hybridCandidate?.price_raw === 229, "the candidate's price is the real brand-site MSRP");
  }

  console.log("\n[A.4] selectByCompositeScore — the brand-site-only candidate is motor-grounded and selectable");
  {
    const motorFamilies = await listMotorFamilies();
    const ourMotor = { familyKey: "magnetic_vector", label: "Magnetic / Vector", modifierKey: null, modifierLabel: null, source: "motor_tech_field" as const };
    const ctx = {
      motorFamilies, ourMotor,
      ourSpecs: { rpm: null, runTimeMinutes: null, cordless: null, buildMaterial: null, bladeTech: null },
      weights: { motor: 0.45, price: 0.35, feature: 0.2 },
    };
    // allowStaticFallbackTopup:false — isolate this one real candidate's own
    // survival; the static-fallback-topup safety net (real trimmer fallback
    // data existing for identity.toolType="trimmer") is an orthogonal,
    // already-tested-elsewhere behavior, not what this assertion checks.
    const scored = selectByCompositeScore([hybridCandidate], TARGET_PRICE, "legacy", identity, 5, ctx as any, { requireMotorEvidenceFirst: true, allowStaticFallbackTopup: false });
    assert(scored.length === 1, `the brand-site-only candidate survives selection (got ${scored.length})`);
    assert(scored[0]?.motor_match_tier === "exact", `its motor evidence ("Vector" in the scraped description) resolves an EXACT tier (got ${scored[0]?.motor_match_tier})`);
    hybridCandidate = scored[0];
  }

  console.log("\n[A.5] buildPricingAnalysis — flows through cleanly, correctly labeled as a brand-site price, no Amazon fields fabricated");
  {
    const analysis = buildPricingAnalysis({
      competitors: [hybridCandidate],
      targetPriceCandidates: [["$259.95", "project_record"]],
    });
    const row = analysis.competitor_prices[0];
    assert(!!row, "a pricing row was produced without throwing");
    assert(row.price_raw === 229, "the pricing row carries the real brand-site price");
    assert(row.price_source === "brand_site", `the row is labeled as brand-site-sourced, not Amazon (got ${row.price_source})`);
    // The exact condition components/analyze/ResultsPanel.tsx's
    // CompetitorTable uses (amazonOnlyEmptyLabel) to show "Sold via
    // brand/pro channels — not on Amazon" instead of a bare "Not available".
    assert(!!hybridCandidate.sources?.brand_site && !hybridCandidate.sources?.amazon, "the UI's brand-site-only empty-state condition is true for this competitor");
  }

  console.log("\n[B] selectByCompositeScore — motor evidence required before brand, wrong-motor product only ever a last resort");
  {
    const motorFamilies = await listMotorFamilies();
    const ourMotor = { familyKey: "magnetic_vector", label: "Magnetic / Vector", modifierKey: null, modifierLabel: null, source: "motor_tech_field" as const };
    const ctx = {
      motorFamilies, ourMotor,
      ourSpecs: { rpm: null, runTimeMinutes: null, cordless: null, buildMaterial: null, bladeTech: null },
      weights: { motor: 0.45, price: 0.35, feature: 0.2 },
    };

    // Brand A: real Vector-motor evidence (verified, should always win a slot).
    const brandAVerified = {
      name: "Brand A Vector Trimmer", brand: "Brand A", price_raw: 255,
      specifications: [{ name: "Motor Type", value: "Vector Motor" }], feature_bullets: [], description: "",
    };
    // Brand B: NO motor evidence at all (a type=search-only hit, nothing to
    // extract) — must resolve "unverified", must NOT be preferred over
    // Brand A above.
    const brandBUnverified = {
      name: "Brand B Trimmer", brand: "Brand B", price_raw: 249,
    };
    // Brand C: CONFIRMED wrong motor (Rotary, not Vector) — real evidence,
    // just a mismatch. Per computeMotorMatchTier this scores LOWER than an
    // unverified candidate on raw motor_score (0.15 vs 0.3), which is
    // exactly why requireMotorEvidenceFirst partitions by "has evidence at
    // all" rather than by raw score — Brand C (evidenced) must still be
    // preferred as a candidate pool member over Brand B (no evidence), even
    // though Brand C won't win on motor match itself.
    const brandCWrongMotor = {
      name: "Brand C Rotary Trimmer", brand: "Brand C", price_raw: 260,
      specifications: [{ name: "Motor Type", value: "Rotary Motor" }], feature_bullets: [], description: "",
    };

    const scored = selectByCompositeScore(
      [brandAVerified, brandBUnverified, brandCWrongMotor],
      TARGET_PRICE, "legacy", identity, 2, ctx as any, { requireMotorEvidenceFirst: true }
    );

    assert(scored.length === 2, `exactly 2 slots filled (limit=2) (got ${scored.length})`);
    assert(scored.some((c: any) => c.brand === "Brand A"), "Brand A (verified exact motor match) is selected");
    assert(scored.some((c: any) => c.brand === "Brand C"), "Brand C (verified, even though wrong motor) is selected over the unverified Brand B");
    assert(!scored.some((c: any) => c.brand === "Brand B"), "Brand B (zero motor evidence) is NOT selected while 2 verified candidates exist to fill both slots");
    assert(!scored.some((c: any) => c.motor_unverified_fallback === true), "no fallback tagging fires — the verified pool alone fully satisfied the limit");

    // Now drop Brand C so only 1 verified candidate exists for a limit of 2
    // — Brand B (unverified) should now be pulled in as an explicitly
    // tagged last resort to fill the remaining slot.
    const scoredWithGap = selectByCompositeScore(
      [brandAVerified, brandBUnverified],
      TARGET_PRICE, "legacy", identity, 2, ctx as any, { requireMotorEvidenceFirst: true }
    );
    assert(scoredWithGap.length === 2, `both slots still filled when the verified pool can't cover them alone (got ${scoredWithGap.length})`);
    const brandBPick = scoredWithGap.find((c: any) => c.brand === "Brand B");
    assert(!!brandBPick && brandBPick.motor_unverified_fallback === true, "Brand B fills the remaining slot ONLY as an explicitly-tagged motor_unverified_fallback pick");

    // Backward compatibility: omitting the option entirely must behave
    // exactly as before (no partitioning at all). allowStaticFallbackTopup:
    // false for the same isolation reason as [A.4] above.
    const scoredDefault = selectByCompositeScore(
      [brandAVerified, brandBUnverified, brandCWrongMotor],
      TARGET_PRICE, "legacy", identity, 5, ctx as any, { allowStaticFallbackTopup: false }
    );
    assert(scoredDefault.length === 3, `omitting requireMotorEvidenceFirst entirely still returns all in-band candidates, unpartitioned (got ${scoredDefault.length})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

// Explicit exit — the OpenAI SDK's HTTP client (and/or the DB-touching
// listMotorFamilies call) can leave a dangling keep-alive handle open,
// which would otherwise keep this process alive after main() resolves.
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
