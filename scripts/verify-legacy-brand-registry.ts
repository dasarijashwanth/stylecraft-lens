// scripts/verify-legacy-brand-registry.ts
// Offline regression check for the curated legacy-brand registry's pure
// logic: category resolution (lib/legacy-brand-registry.ts) and brand/alias
// matching (lib/legacy-brand-discovery.ts). No live Rainforest/OpenAI/Gemini
// call — no .env.local is loaded, pure synchronous functions only.
//
// Run with: npx tsx scripts/verify-legacy-brand-registry.ts

export {};

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

async function main() {
  const { resolveRegistryCategorySlug } = await import("../lib/legacy-brand-registry");
  const { brandMatchesTitle } = await import("../lib/legacy-brand-discovery");

  console.log("\n[1] resolveRegistryCategorySlug — category + audience mapping");
  assert(
    resolveRegistryCategorySlug({ category: "Clippers", subcategory: "Professional Trimmer", targetUser: "pro" }) === "legacy_professional_clippers",
    "pro trimmer -> legacy_professional_clippers"
  );
  assert(
    resolveRegistryCategorySlug({ category: "Clippers", subcategory: "Retail Clipper", targetUser: "consumer" }) === "legacy_retail_clippers",
    "consumer clipper -> legacy_retail_clippers"
  );
  assert(
    resolveRegistryCategorySlug({ category: "Clippers", subcategory: "Shaver", targetUser: "both" }) === "legacy_professional_clippers",
    '"both" defaults to the pro list, per spec ("if ambiguous, default to the pro list")'
  );
  assert(
    resolveRegistryCategorySlug({ category: "Hair Dryers", subcategory: "Blow Dryer", targetUser: "pro" }) === "professional_beauty",
    "pro dryer -> professional_beauty"
  );
  assert(
    resolveRegistryCategorySlug({ category: "Hair Dryers", subcategory: "Blow Dryer", targetUser: "consumer" }) === "retail_beauty",
    "consumer dryer -> retail_beauty"
  );
  assert(
    resolveRegistryCategorySlug({ category: "Flat Irons", subcategory: "Ceramic Straightener", targetUser: "pro" }) === "professional_beauty",
    "pro flat iron -> professional_beauty"
  );
  assert(
    resolveRegistryCategorySlug({ category: "Shaver", subcategory: "Electric Razor", targetUser: "consumer" }) === "legacy_retail_clippers",
    "shaver/razor keywords resolve to the clipper/trimmer/shaver family, not null (category-synonyms.ts already treats shaver as its own key)"
  );
  assert(
    resolveRegistryCategorySlug({ category: "Hair Oil Dispenser", subcategory: "Bottle", targetUser: "pro" }) === null,
    "genuinely out-of-registry category returns null (never forces a default category)"
  );
  assert(
    resolveRegistryCategorySlug({ category: "", subcategory: "", targetUser: "pro" }) === null,
    "empty category/subcategory returns null"
  );

  console.log("\n[2] brandMatchesTitle — word-boundary, accent/typography-safe brand matching");
  assert(
    brandMatchesTitle("BaBylissPRO FX870 Cordless Clipper", "BaByliss", ["BaBylissPRO", "Babyliss Pro"]) === true,
    "BaByliss matches via its BaBylissPRO alias"
  );
  assert(
    brandMatchesTitle("Babyliss Pro Barberology Clipper", "BaByliss", ["BaBylissPRO", "Babyliss Pro"]) === true,
    'BaByliss matches via the "Babyliss Pro" (two-word) alias, case-insensitive'
  );
  assert(
    brandMatchesTitle("L'Oréal Professional Steampod", "L'Oreal", ["L'Oréal", "LOreal", "L Oreal"]) === true,
    "L'Oreal matches an accented title via its L'Oréal alias (NFKD-normalized)"
  );
  assert(
    brandMatchesTitle("LOREAL PARIS Infallible Iron", "L'Oreal", ["L'Oréal", "LOreal", "L Oreal"]) === true,
    "L'Oreal matches an all-caps, no-apostrophe title via its LOreal alias"
  );
  assert(
    brandMatchesTitle("T3 Micro Ionic AireLuxe Dryer", "T3") === true,
    'T3 matches when it appears as its own whole word/token ("T3 Micro...")'
  );
  assert(
    brandMatchesTitle("GT3000 Turbo Hair Dryer", "T3") === false,
    'T3 does NOT match inside an unrelated token ("GT3000") — false-positive guard for short aliases'
  );
  assert(
    brandMatchesTitle("JRL Professional 2020C Clipper", "JRL") === true,
    "JRL matches as its own whole word"
  );
  assert(
    brandMatchesTitle("Major League Trimmer Set", "JRL") === false,
    'JRL does NOT match "Major League" (no whole-word "jrl" token present)'
  );
  assert(
    brandMatchesTitle("Hot Tools Professional 24K Gold Iron", "Hot Tools", ["Hot Tools Professional"]) === true,
    "multi-word brand name matches when every word appears in the title"
  );
  assert(
    brandMatchesTitle("Conair Infiniti Pro Dryer", "Hot Tools", ["Hot Tools Professional"]) === false,
    "an unrelated brand's title never matches"
  );

  console.log(`\n${passes} passed, ${failures} failed`);
  // Explicit exit — importing lib/legacy-brand-registry.ts pulls in
  // memoryDb.ts, whose autosave setInterval otherwise keeps the process
  // alive indefinitely after main() finishes.
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
