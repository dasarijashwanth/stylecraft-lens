// scripts/verify-review-quote-dates.ts
// Offline regression check for the broken review-evidence date rendering
// bug: raw ISO timestamps ("2026-07-24T00:00:00.000Z"), raw/duplicated
// "Reviewed in the United States on June 12, 2026Reviewed in..." strings,
// and inconsistent date formats mixed in one evidence list. Uses the exact
// broken examples the bug report showed, as fixtures.
//
// No live Rainforest/OpenAI/Gemini calls — no .env.local loaded, no keys
// set, so hasOpenAIKey/hasGeminiKey are false and checkQuoteQuality's own
// AI call short-circuits to its fail-open path (same "can't test AI-
// dependent behavior offline" limitation scripts/verify-review-tiers.ts
// already documents) — this script covers everything that doesn't require
// a live model call: date parsing/formatting, and that a quote's date now
// comes from the matched source review, never from the AI's own echo.
//
// Run with: npx tsx scripts/verify-review-quote-dates.ts

export {};

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

async function main() {
  const { parseRainforestReviewDate } = await import("../lib/rainforest");
  const { formatReviewDate } = await import("../lib/provenance-format");
  const { verifyThemes } = await import("../lib/amazon-review-analysis");

  console.log("\n[1] parseRainforestReviewDate — ingestion-time normalization");
  assert(
    parseRainforestReviewDate({ utc: "2026-07-24T00:00:00.000Z" }).date === "2026-07-24",
    "an ISO utc timestamp normalizes to a plain date-only string"
  );
  assert(
    parseRainforestReviewDate({ raw: "Reviewed in the United States on June 12, 2026" }).date === "2026-06-12",
    "a raw 'Reviewed in {country} on {date}' phrase (no utc) parses to the same canonical date"
  );
  assert(
    parseRainforestReviewDate({ raw: "Reviewed in the United States on June 12, 2026" }).country === "United States",
    "country is captured separately, never folded into the date string"
  );
  // The exact broken example from the bug report — the phrase duplicated
  // back-to-back with zero separator, exactly as it rendered to the user.
  const doubled = parseRainforestReviewDate({ raw: "Reviewed in the United States on June 12, 2026Reviewed in the United States on June 12, 2026" });
  assert(doubled.date === "2026-06-12", `a duplicated/concatenated raw phrase still parses to one clean date (got ${doubled.date})`);
  assert(!!doubled.country && !doubled.country.includes("Reviewed"), "the duplication doesn't leak into the captured country either");
  assert(parseRainforestReviewDate(null).date === null, "null input parses to null, never a placeholder string");
  assert(parseRainforestReviewDate({}).date === null, "an empty object parses to null");
  assert(parseRainforestReviewDate({ raw: "not a date at all" }).date === null, "unparseable garbage parses to null, not a crash or garbage string");

  console.log("\n[2] formatReviewDate — display formatting");
  assert(formatReviewDate("2026-07-24") === "Jul 24, 2026", `a canonical date formats as "Mon D, YYYY" (got ${formatReviewDate("2026-07-24")})`);
  assert(formatReviewDate(null) === null, "null formats to null (render nothing), never a placeholder string");
  assert(formatReviewDate("") === null, "empty string formats to null");
  assert(formatReviewDate("garbage") === null, "unparseable input formats to null, never crashes or echoes the garbage");
  // Defense in depth: even if a full ISO timestamp somehow reached this
  // function (it shouldn't, post-fix), it must never render the raw "T…Z"
  // suffix a user would see as broken text.
  assert(!String(formatReviewDate("2026-07-24T00:00:00.000Z")).includes("T00:00:00"), "even a raw ISO timestamp never renders its time-of-day suffix");

  console.log("\n[3] verifyThemes — evidence date comes from the matched review, never the AI's own echo");
  const sourceReviews = [
    { title: "Great motor", body: "Very smooth and powerful. Works every time without fail.", rating: 5, date: "2026-07-24", verifiedPurchase: true },
    { title: "Decent", body: "All-metal construction gives them a premium feel overall.", rating: 4, date: "2026-06-12", verifiedPurchase: true },
  ];
  // Simulates the AI echoing a raw/garbled date into its own JSON output —
  // exactly the failure mode that used to reach the UI verbatim.
  const aiThemes = [
    {
      theme: "Powerful motor",
      evidence: [
        { quote: "Very smooth and powerful.", date: "2026-07-24T00:00:00.000Z" },
        { quote: "Works every time without fail.", date: "garbage-not-a-date" },
      ],
    },
    {
      theme: "Premium feel",
      evidence: [
        // AI echoed the source's own "Reviewed in..." boilerplate INTO the
        // quote, duplicated — the exact contamination this fix strips.
        { quote: "all-metal construction gives them a premium feel Reviewed in the United States on June 12, 2026Reviewed in the United States on June 12, 2026", date: null },
        { quote: "premium feel overall", date: null },
      ],
    },
  ];
  const verified = verifyThemes(aiThemes, sourceReviews as any, "customer_reviews");
  assert(verified.length === 2, `both themes survive verification (got ${verified.length})`);

  const powerfulTheme = verified.find(t => t.theme === "Powerful motor");
  assert(!!powerfulTheme, "the 'Powerful motor' theme is present");
  const firstEvidenceDate = powerfulTheme?.evidence[0]?.date;
  assert(firstEvidenceDate === "2026-07-24", `evidence date is taken from the matched review's own normalized date, NOT the AI's raw ISO echo (got ${firstEvidenceDate})`);
  assert(formatReviewDate(firstEvidenceDate) === "Jul 24, 2026", "that date renders as clean 'Jul 24, 2026' text, matching the bug report's expected output");

  const premiumTheme = verified.find(t => t.theme === "Premium feel");
  assert(!!premiumTheme, "the 'Premium feel' theme is present");
  const contaminatedQuote = premiumTheme?.evidence.find(e => e.quote.startsWith("all-metal"));
  assert(!!contaminatedQuote, "the contaminated quote still verifies (the real words are still a match)");
  assert(!contaminatedQuote!.quote.includes("Reviewed in"), `the stored quote no longer contains the embedded "Reviewed in..." boilerplate (got: "${contaminatedQuote?.quote}")`);
  assert(!contaminatedQuote!.quote.includes("2026" ) || contaminatedQuote!.quote === "all-metal construction gives them a premium feel", "the quote contains only the reviewer's own words after stripping");
  assert(contaminatedQuote!.date === "2026-06-12", "this evidence's date is also correctly taken from its matched review (2026-06-12), not left null from the AI's own (unused) date field");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
