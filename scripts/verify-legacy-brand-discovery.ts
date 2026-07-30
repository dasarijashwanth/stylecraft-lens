// scripts/verify-legacy-brand-discovery.ts
// Offline regression check for lib/legacy-brand-discovery.ts's
// searchCuratedLegacyBrands — the widenStep 0->2 loop, per-brand progress
// callback, and time-budget cutoff — against a stubbed Rainforest
// type=search response. globalThis.fetch is replaced entirely before
// anything is imported (same pattern as scripts/verify-review-tiers.ts),
// so this makes zero real network/API calls and spends zero credits.
//
// Also confirms lib/analysisEngine.ts's applyPriceBandGate never injects an
// unrelated static fallback competitor when called with
// { allowStaticFallbackTopup: false } — the exact bug the curated-only gate
// call must avoid (see the Project plan's Context section).
//
// Run with: npx tsx scripts/verify-legacy-brand-discovery.ts

export {};

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

function makeBrand(name: string, sortOrder: number, aliases: string[] = []): any {
  return {
    id: `brand_${name.toLowerCase()}`,
    category_id: "cat_test",
    brand_name: name,
    aliases,
    enabled: true,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function searchResultPayload(items: { asin: string; title: string; price: number | null }[]) {
  return JSON.stringify({
    search_results: items.map(it => ({
      asin: it.asin,
      title: it.title,
      sponsored: false,
      prices: it.price != null ? [{ value: it.price, raw: `$${it.price.toFixed(2)}` }] : [],
      rating: 4.5,
      ratings_total: 1200,
      recent_sales: "300+ bought in past month",
    })),
  });
}

const TARGET_PRICE = 259.95;
const IDENTITY = { category: "Clippers", subcategory: "Professional Trimmer", toolType: "trimmer" as const };
const CATEGORY_SLUG = "legacy_professional_clippers" as const;

// Mirrors lib/memoryDb.ts's seedToolTypeDefaults exactly (the real
// production seed) — covers at least clipper/trimmer/shaver, the types this
// script's fixtures actually exercise.
function makeToolTypesFixture(): any[] {
  const now = new Date().toISOString();
  const defs: { key: string; label: string; aliases: string[]; family: string | null }[] = [
    { key: "trimmer", label: "Trimmer", aliases: ["trimmer", "beard trimmer", "detailer", "outliner", "liner", "edger"], family: "clipper_trimmer_shaver" },
    { key: "shaver", label: "Shaver", aliases: ["shaver", "foil shaver", "rotary shaver", "electric shaver", "razor"], family: "clipper_trimmer_shaver" },
    { key: "dryer", label: "Hair Dryer", aliases: ["dryer", "blow dryer", "diffuser"], family: "beauty" },
    { key: "flat_iron", label: "Flat Iron", aliases: ["flat iron", "straightener", "hair iron"], family: "beauty" },
    { key: "curling_iron", label: "Curling Iron", aliases: ["curling iron", "curling wand", "curler", "wand"], family: "beauty" },
    { key: "hot_brush", label: "Hot Brush", aliases: ["hot brush", "styling brush", "heated brush"], family: "beauty" },
    { key: "clipper", label: "Clipper", aliases: ["clipper"], family: "clipper_trimmer_shaver" },
    { key: "other_styling", label: "Other Styling Tool", aliases: [], family: "beauty" },
    { key: "combo", label: "Combo / Multi-Tool Kit", aliases: [], family: null },
  ];
  return defs.map((d, i) => ({
    id: `ttype_${d.key}`, type_key: d.key, label: d.label, aliases: d.aliases, family: d.family,
    enabled: true, custom: false, sort_order: i, created_at: now, updated_at: now,
  }));
}
const TOOL_TYPES = makeToolTypesFixture();

let scenario: "widen" | "time_budget" = "widen";
let sawSearchTerms: string[] = [];

(globalThis as any).fetch = async (input: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.includes("rainforestapi.com")) return new Response("{}", { status: 500 });

  const u = new URL(url);
  if (u.searchParams.get("type") !== "search") return new Response("{}", { status: 500 });
  const searchTerm = u.searchParams.get("search_term") || "";
  sawSearchTerms.push(searchTerm);

  if (scenario === "time_budget") {
    // Artificial delay so the budget check (using a tiny override) trips
    // before the loop would otherwise finish all 3 widen steps.
    await new Promise(r => setTimeout(r, 50));
    return new Response(searchResultPayload([]), { status: 200 });
  }

  if (searchTerm.startsWith("Wahl")) {
    return new Response(searchResultPayload([{ asin: "B0WAHL0001", title: "Wahl Professional Trimmer Pro", price: 249.95 }]), { status: 200 });
  }
  if (searchTerm.startsWith("Andis")) {
    // $350 is outside +/-30% ($337.94 max) but inside +/-40% ($363.93 max) —
    // only matches after the band widens once.
    return new Response(searchResultPayload([{ asin: "B0ANDIS001", title: "Andis Professional Trimmer Elite", price: 350.0 }]), { status: 200 });
  }
  if (searchTerm.startsWith("Oster")) {
    return new Response(searchResultPayload([]), { status: 200 }); // never matches, at any widen step
  }
  return new Response(searchResultPayload([]), { status: 200 });
};

async function main() {
  const { searchCuratedLegacyBrands, CURATED_BRAND_SEARCH_TIME_BUDGET_MS } = await import("../lib/legacy-brand-discovery");
  const { applyPriceBandGate } = await import("../lib/analysisEngine");

  console.log("\n[1] searchCuratedLegacyBrands — widen-step progression + per-brand outcomes");
  scenario = "widen";
  sawSearchTerms = [];
  const progressSnapshots: any[][] = [];
  const brands = [makeBrand("Wahl", 0), makeBrand("Andis", 1), makeBrand("Oster", 2)];

  const candidates = await searchCuratedLegacyBrands(
    brands,
    IDENTITY,
    TARGET_PRICE,
    CATEGORY_SLUG,
    TOOL_TYPES,
    async (entries) => { progressSnapshots.push(JSON.parse(JSON.stringify(entries))); }
  );

  assert(candidates.length === 2, `exactly Wahl + Andis matched (got ${candidates.length})`);
  assert(candidates.some(c => c.registry_brand === "Wahl" && c.price_raw === 249.95), "Wahl matched at its real searched price, unchanged");
  assert(candidates.some(c => c.registry_brand === "Andis" && c.price_raw === 350.0), "Andis matched only after the band widened");
  assert(!candidates.some(c => c.registry_brand === "Oster"), "Oster (no in-band product at any widen step) never appears in the candidate pool");
  assert(candidates.every(c => c.curated_brand === true && c.verified_by_rainforest === true), "every curated match is tagged curated_brand + verified_by_rainforest");
  assert(sawSearchTerms.some(t => t.includes("Oster") && t.includes("Professional Trimmer")), 'search term combines brand + subcategory (e.g. "Oster Professional Trimmer")');

  const finalProgress = progressSnapshots[progressSnapshots.length - 1];
  const osterEntry = finalProgress.find((e: any) => e.brand === "Oster");
  assert(osterEntry?.status === "not_found" && osterEntry?.reason === "No in-band product found", `Oster's final progress entry is honestly "not_found" with the right reason (got ${JSON.stringify(osterEntry)})`);
  const andisEntry = finalProgress.find((e: any) => e.brand === "Andis");
  assert(andisEntry?.status === "found" && typeof andisEntry?.reason === "string" && andisEntry.reason.includes("widened"), `Andis's progress entry notes it was found via a widened band (got ${JSON.stringify(andisEntry)})`);
  assert(progressSnapshots.length >= 2, `onBrandProgress was called incrementally, not just once at the end (got ${progressSnapshots.length} snapshots)`);

  console.log("\n[2] searchCuratedLegacyBrands — time-budget cutoff never leaves a brand stuck \"searching\"");
  scenario = "time_budget";
  const timeBudgetBrands = [makeBrand("Wahl", 0), makeBrand("Andis", 1)];
  const cutoffCandidates = await searchCuratedLegacyBrands(
    timeBudgetBrands,
    IDENTITY,
    TARGET_PRICE,
    CATEGORY_SLUG,
    TOOL_TYPES,
    undefined,
    10 // 10ms override — the mock's 50ms delay guarantees this trips before step 2
  );
  assert(cutoffCandidates.length === 0, "no candidates matched (every mock response was empty) — the cutoff didn't fabricate anything");
  // Raised from 15_000 to 20_000 — the brand-site pass now runs
  // CONCURRENTLY with this Amazon leg (its own independent ~12s budget),
  // so total wall time is ~max(12s, 20s), not a sum; see
  // lib/legacy-brand-discovery.ts's header comment.
  assert(CURATED_BRAND_SEARCH_TIME_BUDGET_MS === 20_000, `production constant is unaffected by the test override (still ${CURATED_BRAND_SEARCH_TIME_BUDGET_MS}ms)`);

  console.log("\n[3] applyPriceBandGate — allowStaticFallbackTopup:false never injects the unrelated static dataset");
  const identityForGate: any = {
    productName: "Test Dryer", brand: null, category: "Hair Dryers", subcategory: "Blow Dryer", toolType: "dryer",
    whatItIs: "dryer", keyAttributes: [], targetUser: "pro", priceObserved: null, confidence: "high", evidence: [], identityStatus: "verified",
  };
  // Zero real candidates — a category where getCategoryFallbackCompetitors
  // DOES have static mock data (dryers), so the bug (if present) would show
  // up as Parlux/Zuvi/Laifen/etc. appearing despite allowStaticFallbackTopup:false.
  const gatedNoTopup = applyPriceBandGate([], 150, "legacy", identityForGate, TOOL_TYPES, 5, { allowStaticFallbackTopup: false });
  assert(gatedNoTopup.length === 0, `allowStaticFallbackTopup:false returns zero results instead of static mock data (got ${gatedNoTopup.length}: ${gatedNoTopup.map((c: any) => c.name).join(", ")})`);

  const gatedWithTopup = applyPriceBandGate([], 150, "legacy", identityForGate, TOOL_TYPES, 5);
  assert(gatedWithTopup.length > 0, `default behavior (allowStaticFallbackTopup unset, i.e. true) is UNCHANGED — still tops up from static data (got ${gatedWithTopup.length})`);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
