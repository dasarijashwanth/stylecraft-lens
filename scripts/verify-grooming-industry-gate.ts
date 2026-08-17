// scripts/verify-grooming-industry-gate.ts
// Offline regression check for lib/grooming-industry-gate.ts's
// passesGroomingIndustryGate — the hard, fail-closed grooming/beauty
// industry gate that fixes the real pre-launch bug where an "Electric Weed
// Wacker with Wheel" and a "Waterproof Brushless DC Motor... for Efoil
// Electric Surfboard" both scored as strong "competitors" for a hair
// clipper. No live API calls — rules come from memoryDb's own auto-seeded
// defaults (lib/memoryDb.ts's seedGroomingGateRuleDefaults, always run in
// the constructor), reached via listGroomingGateRules() with no
// .env.local loaded (isSupabaseConfigured stays false).
//
// Run with: npx tsx scripts/verify-grooming-industry-gate.ts

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
  const { passesGroomingIndustryGate } = await import("../lib/grooming-industry-gate");
  const { listGroomingGateRules } = await import("../lib/db/grooming-gate-rules");
  const { listToolTypes } = await import("../lib/db/tool-types");

  const rules = await listGroomingGateRules();
  const toolTypes = await listToolTypes();
  assert(rules.length > 0, `memoryDb auto-seeds grooming gate rule defaults (got ${rules.length} rules)`);
  assert(rules.some(r => r.rule_type === "block_category_segment" && r.value === "Patio, Lawn & Garden"), "seeded defaults include the 'Patio, Lawn & Garden' block-category rule");

  console.log("\n[a] Electric Weed Wacker with Wheel — real product wrongly scored as a hair-clipper competitor pre-fix");
  const weedWacker = passesGroomingIndustryGate(
    { name: "Electric Weed Wacker with Wheel", categories: ["Patio, Lawn & Garden"], description: "powerful brushless motor, cuts weeds and grass easily" },
    rules,
    { stage: "post_enrichment", toolTypes }
  );
  assert(weedWacker.ok === false, `weed wacker with a blocked category is rejected (got ok=${weedWacker.ok})`);
  assert(weedWacker.reason === "block_category", `rejected specifically via the 1A block-category check, before any keyword check ever runs (got reason=${weedWacker.reason})`);

  console.log("\n[b] Waterproof Brushless DC Motor... for Efoil Electric Surfboard — bare component, wrong domain, no category data");
  const efoilMotor = passesGroomingIndustryGate(
    { name: "Waterproof Brushless DC Motor, Outrunner brushless DC Motor for Underwater Working, for Direct-Drive Propeller Efoil Electric Surfboard Use", categories: null },
    rules,
    { stage: "post_enrichment", toolTypes }
  );
  assert(efoilMotor.ok === false, `bare motor/component for a surfboard is rejected (got ok=${efoilMotor.ok})`);
  // The ticket's own text expected this to fail via cross_domain_use_phrase
  // or component_disqualifier (1F) — but 1B (the required-keyword check)
  // runs BEFORE 1F and unconditionally rejects first whenever NO
  // required_keyword ("hair", "clipper", "trimmer", "shaver", "foil",
  // etc.) appears as its own whole word anywhere in the text. This text's
  // only near-miss is "Efoil" — a single token, never split into "e" +
  // "foil" by the token-set whole-word matching lib/tool-type-taxonomy.ts's
  // textContainsPhrase uses (confirmed by reading it) — so it never
  // matches the "foil" required_keyword. The real, verified behavior of
  // the already-built (not-to-be-modified) gate is an earlier, equally
  // valid rejection reason; asserting the true reason here rather than the
  // ticket's guess, per CLAUDE.md's "don't weaken assertions" rule cutting
  // both ways — this asserts the REAL, most-specific reason, not a vaguer
  // stand-in.
  assert(efoilMotor.reason === "inconclusive_category_and_keywords", `rejected via the 1B required-keyword gate (fires before 1F's cross-domain/component checks) — got reason=${efoilMotor.reason}`);

  console.log("\n[c] category-less, keyword-less candidate — fails closed");
  const blank = passesGroomingIndustryGate(
    { name: "Generic Product Model XYZ-3000", categories: null },
    rules,
    { stage: "post_enrichment", toolTypes }
  );
  assert(blank.ok === false, `a candidate with no category data and no grooming/beauty keyword at all is rejected (got ok=${blank.ok})`);
  assert(blank.reason === "inconclusive_category_and_keywords", `rejected specifically as inconclusive (fail-closed), not silently waved through (got reason=${blank.reason})`);

  console.log("\n[d] bare 'Trimmer' — ambiguous across industries, disambiguated by co-occurring context");
  const bareTrimmer = passesGroomingIndustryGate(
    { name: "ProCut 5000 Trimmer" },
    rules,
    { stage: "post_enrichment", toolTypes }
  );
  // No beard/hair/outdoor context at all here — the trimmer_missing_cosignal
  // rule only fires when a bare "trimmer" hit co-occurs with an outdoor/
  // garden signal (e.g. "lawn", "weed", or a block-category phrase) in the
  // SAME text; with zero such signal present, there is nothing to
  // disambiguate against, so the real (verified) behavior is that this
  // passes — bare "Trimmer" is deliberately NOT blocked on its own, since
  // it's also a genuine grooming category (see lib/memoryDb.ts's own
  // seed-data comment on this exact point).
  assert(bareTrimmer.ok === true, `bare "Trimmer" with zero outdoor/context signal passes — nothing to disambiguate against (got ok=${bareTrimmer.ok}, reason=${bareTrimmer.reason})`);

  const beardTrimmer = passesGroomingIndustryGate(
    { name: "ProCut 5000 Trimmer", description: "beard trimmer for men" },
    rules,
    { stage: "post_enrichment", toolTypes }
  );
  assert(beardTrimmer.ok === true, `the same title + "beard trimmer for men" wording passes cleanly — "beard" and "trimmer" both hit required_keyword (got ok=${beardTrimmer.ok})`);

  console.log("\n[e] bare 'Trimmer' + an outdoor/garden signal but no beard/hair/barber/body co-signal — rejected");
  // Deliberately uses a block_category_segment phrase ("Outdoor Power
  // Tools") whose own words are NOT themselves in the disqualifying_keyword
  // list (unlike "lawn"/"garden"/"weed"/"grass"/"hedge", which double as
  // both a block-category word AND a disqualifying_keyword — for those,
  // the disqualifying_keyword check earlier in the same 1B block already
  // rejects first, via reason:"disqualifying_keyword", before the
  // trimmer-cosignal branch is ever reached) — this is the fixture that
  // actually exercises trimmer_missing_cosignal specifically.
  const outdoorTrimmer = passesGroomingIndustryGate(
    { name: "ProCut 5000 Trimmer", description: "an outdoor power tool for tough jobs" },
    rules,
    { stage: "post_enrichment", toolTypes }
  );
  assert(outdoorTrimmer.ok === false, `bare "trimmer" + an outdoor/garden signal with no beard/hair/barber/body co-signal is rejected (got ok=${outdoorTrimmer.ok})`);
  assert(outdoorTrimmer.reason === "trimmer_missing_cosignal", `rejected specifically via trimmer_missing_cosignal (got reason=${outdoorTrimmer.reason})`);

  console.log("\n[f] Broad-audit fix — a real, correctly-typed static-fallback entry with a bare brand+model name (no keyword) is rejected with no context, but passes once given its known-true tool-type label as description");
  // "Wahl Professional 5-Star Cordless Magic Clip" is a REAL entry in
  // lib/analysisEngine.ts's getCategoryFallbackCompetitors static clipper
  // fallback pool — this exact name has no "clipper"/"hair"/etc. token, so
  // the pre-fix static-fallback-topup loop (which passed only `fb.name`)
  // silently rejected most of what's supposed to be a guaranteed floor.
  const bareBrandModel = passesGroomingIndustryGate(
    { name: "Wahl Professional 5-Star Cordless Magic Clip" },
    rules,
    { stage: "pre_enrichment", toolTypes, requiredToolType: "clipper" }
  );
  assert(bareBrandModel.ok === false, `bare brand+model with no context and no keyword is rejected pre-fix-equivalent (got ok=${bareBrandModel.ok})`);

  const withKnownTrueLabel = passesGroomingIndustryGate(
    { name: "Wahl Professional 5-Star Cordless Magic Clip", description: "Clipper" },
    rules,
    { stage: "pre_enrichment", toolTypes, requiredToolType: "clipper" }
  );
  assert(withKnownTrueLabel.ok === true, `the SAME entry passes once given its own known-true tool-type label as description (got ok=${withKnownTrueLabel.ok}, reason=${withKnownTrueLabel.reason})`);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
