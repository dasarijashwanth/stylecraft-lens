// scripts/verify-brand-voice.ts
// Offline regression check for the Brand Voice Guide system: tone-spectrum
// routing (lib/brand-voice.ts), deterministic voice lint rules
// (lib/brand-voice-lint.ts), and brand/version resolution + fallback
// behavior. Pure-function or memoryDb-backed only — no live
// Rainforest/OpenAI/Gemini/Supabase call, no .env.local loaded, matching
// this repo's scripts/verify-*.ts convention.
//
// Run with: npx tsx scripts/verify-brand-voice.ts

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
  const { getToneDirective, getToneForGtmField, getActiveVoiceGuide, buildVoiceBlock } = await import("../lib/brand-voice");
  const { applyDeterministicFixes, findDeterministicViolations } = await import("../lib/brand-voice-lint");

  // ---- Section 1: Register / tone-spectrum fixtures ----
  console.log("\n[1] Register fixtures — tone directives measurably differ per content type");
  const educationDirective = getToneDirective("education");
  const supportDirective = getToneDirective("support");
  const launchDirective = getToneDirective("launch");
  assert(educationDirective !== supportDirective, "education directive differs from support directive");
  assert(supportDirective !== launchDirective, "support directive differs from launch directive");
  assert(educationDirective !== launchDirective, "education directive differs from launch directive");
  assert(/no attitude|no swagger/i.test(supportDirective), "support register explicitly excludes attitude/swagger");
  assert(/hype|culture/i.test(launchDirective), "launch register explicitly allows hype/culture in the CAPS lead");

  assert(getToneForGtmField("expert_tip") === "education", "expert_tip routes to education register");
  assert(getToneForGtmField("faq_answer_1", "faq_answer") === "support", "faq_answer_* routes to support register via group id");
  assert(getToneForGtmField("features_full_list_1", "features_full_list") === "launch", "features_full_list_* routes to launch register via group id");
  assert(getToneForGtmField("positioning_statement") === "product_detail", "positioning_statement routes to product_detail register");
  assert(getToneForGtmField("some_unmapped_field_id") === null, "an unmapped field id has no tone routing (null, not a default guess)");

  // ---- Section 2: Deterministic lint fixtures — each checks the SPECIFIC rule ----
  console.log("\n[2] Lint fixtures — deterministic rule checks");

  const bannedPhrase = findDeterministicViolations("We deeply appreciate our valued customers.", "support");
  assert(bannedPhrase.some(v => v.rule === "corporate_distance"), '"valued customers" flagged as corporate_distance');

  const doubleExclamation = findDeterministicViolations("This is amazing! You'll love it!", "peer_selling");
  assert(doubleExclamation.some(v => v.rule === "too_many_exclamations"), "2 exclamation marks flagged as too_many_exclamations");
  const singleExclamation = findDeterministicViolations("This is amazing!", "peer_selling");
  assert(!singleExclamation.some(v => v.rule === "too_many_exclamations"), "a single exclamation mark is NOT flagged (1 is the allowed max)");

  const capsInSupport = findDeterministicViolations("THIS TOOL delivers real results.", "support");
  assert(capsInSupport.some(v => v.rule === "caps_outside_launch"), "body-copy ALL CAPS flagged outside the launch register");
  const capsInLaunch = findDeterministicViolations("THIS TOOL delivers real results.", "launch");
  assert(!capsInLaunch.some(v => v.rule === "caps_outside_launch"), "the SAME ALL CAPS text is NOT flagged inside the launch register");

  const sicFix = applyDeterministicFixes("The SIC Pro mat completes the set.");
  assert(sicFix.text.includes("S|C Pro"), '"SIC Pro" auto-fixed to "S|C Pro" (not just flagged)');
  assert(sicFix.fixes.some(f => f.rule === "sc_standardization"), "the S|C fix is recorded under sc_standardization");

  const unanchoredPraise = findDeterministicViolations("This clipper delivers great performance for any professional.", "product_detail");
  assert(unanchoredPraise.some(v => v.rule === "unanchored_generic_praise"), '"great performance" with no spec nearby flagged as unanchored_generic_praise');
  const anchoredPraise = findDeterministicViolations("This clipper delivers great performance at 7,800rpm.", "product_detail");
  assert(!anchoredPraise.some(v => v.rule === "unanchored_generic_praise"), "the SAME phrase is NOT flagged once a real spec/number appears in the same text");

  const uncitedSuperlative = findDeterministicViolations("It's the best in the world.", "product_detail");
  assert(uncitedSuperlative.some(v => v.rule === "uncited_superlative"), '"best in the world" flagged as uncited_superlative with no citation');
  const citedSuperlative = findDeterministicViolations("It's the best in the world.", "product_detail", { hasCitation: true });
  assert(!citedSuperlative.some(v => v.rule === "uncited_superlative"), "the SAME superlative is NOT flagged once hasCitation is true");

  // ---- Section 3: Terminology — register-conditional, not a universal ban ----
  console.log("\n[3] Terminology fixtures — community terms are register-conditional");
  const famInSocial = findDeterministicViolations("Welcome to the Fam.", "social");
  assert(!famInSocial.some(v => v.rule === "community_term_outside_social"), '"the Fam" passes in the social register');
  const famInProductDetail = findDeterministicViolations("Welcome to the Fam.", "product_detail");
  assert(famInProductDetail.some(v => v.rule === "community_term_outside_social"), '"the Fam" is flagged in the product_detail register');

  // ---- Section 4: Brand routing — fallback vs. real seeded guide ----
  console.log("\n[4] Brand routing fixtures");
  const gammaGuide = await getActiveVoiceGuide("Gamma+");
  assert(gammaGuide.noGuideOnFile === true, "Gamma+ (no seeded row) falls back to noGuideOnFile: true");
  assert(gammaGuide.id === null && gammaGuide.version === null, "Gamma+'s fallback guide has no id/version");
  assert(gammaGuide.content.length > 0, "Gamma+ still gets a real (neutral-professional) fallback block, never empty");

  const styleCraftGuide = await getActiveVoiceGuide("StyleCraft");
  assert(styleCraftGuide.noGuideOnFile === false, "StyleCraft has a real active guide (noGuideOnFile: false)");
  assert(styleCraftGuide.version === 1, "StyleCraft's seeded guide is version 1");
  assert(styleCraftGuide.content.includes("## 1. Brand Personality"), "StyleCraft's guide content is the real seeded markdown, not a stub");

  const styleCraftBlock = buildVoiceBlock(styleCraftGuide);
  assert(styleCraftBlock.includes("Bold & Competitive"), "the condensed voice block includes a real attribute name from the guide");
  assert(styleCraftBlock.includes("Hard rules:"), "the condensed voice block includes the 3 hard rules section");
  assert(!styleCraftBlock.includes('""'), "the condensed voice block has no double-quote nesting artifacts");

  const gammaBlock = buildVoiceBlock(gammaGuide);
  assert(gammaBlock.includes("no brand voice guide on file"), "Gamma+'s block is explicitly flagged as having no guide on file");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
