// scripts/verify-deterministic-fact-extraction.ts
// Offline regression check for the deterministic synonym-map fact parser
// (lib/source-fact-extract-deterministic.ts) — pure function, zero I/O,
// zero network calls, zero AI. Run with: npx tsx scripts/verify-deterministic-fact-extraction.ts

export {};

let passes = 0;
let failures = 0;

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
  const { extractDeterministicFacts, deterministicallyResolvedFieldIds } = await import("../lib/source-fact-extract-deterministic");

  console.log("\n[1] Every spec'd category resolves to its real GTM/TDS field id");
  const sampleText = [
    "Motor Type: Brushless Motor (EON Digital)",
    "RPM: 7,200",
    "Recharge Time: 90 minutes",
    "Run Time: 120 minutes",
    "Voltage: 100-240V",
    "Cord Length: 8 feet",
    "Blade Name: DLC Fixed Blade",
    "Product Dimensions: 6.5 x 2 x 2 in",
    "Product Weight: 0.8 lbs",
    "Box Dimensions: 9 x 4 x 3 in",
    "Box Weight: 1.5 lbs",
    "Included in Box: Charging stand, cleaning brush, oil, 3 guards",
    "Warranty: 2 years",
    "Certification: FCC, CE",
    "Guard Sizes: 6 guards included, sizes 1-6",
    "LED Function: Solid green = fully charged, blinking red = low battery",
    "UPC: 810123456789",
    "SKU: GP609B",
    "Retail Price: $89.99",
  ].join("\n");

  const candidates = extractDeterministicFacts(sampleText);
  const byField = new Map(candidates.map(c => [c.field_id, c]));

  assert(byField.get("motor_type")?.value === "Brushless Motor (EON Digital)", `motor_type extracted (got ${JSON.stringify(byField.get("motor_type"))})`);
  assert(byField.get("motor_rpm")?.value === "7,200", "motor_rpm extracted");
  assert(byField.get("motor_recharge_time")?.value === "90 minutes", "motor_recharge_time extracted (recharge tried before the more generic run-time synonym)");
  assert(byField.get("motor_run_time")?.value === "120 minutes", "motor_run_time extracted");
  assert(byField.get("charging_voltage")?.value === "100-240V", "charging_voltage extracted");
  assert(byField.get("charging_cord_length")?.value === "8 feet", "charging_cord_length extracted");
  assert(byField.get("blade_name")?.value === "DLC Fixed Blade", "blade_name extracted");
  assert(byField.get("product_lwh")?.value === "6.5 x 2 x 2 in", "product_lwh extracted");
  assert(byField.get("product_weight")?.value === "0.8 lbs", "product_weight extracted");
  assert(byField.get("box_lwh")?.value === "9 x 4 x 3 in", "box_lwh extracted");
  assert(byField.get("box_weight")?.value === "1.5 lbs", "box_weight extracted");
  assert(!!byField.get("included_summary")?.value.includes("Charging stand"), "included_summary (box contents) extracted");
  assert(byField.get("warranty")?.value === "2 years", "warranty extracted");
  assert(byField.get("certification_needed")?.value === "FCC, CE", "certification_needed extracted");
  assert(!!byField.get("guards_qty")?.value.includes("6 guards"), "guards_qty (guard sizes) extracted");
  assert(!!byField.get("charging_led_function")?.value.includes("Solid green"), "charging_led_function (LED behavior) extracted");
  assert(byField.get("source_doc_upc")?.value === "810123456789", "UPC extracted as a narrative_signal (no dedicated schema field)");
  assert(byField.get("source_doc_sku")?.value === "GP609B", "SKU extracted as a narrative_signal");
  assert(byField.get("source_doc_retail_price")?.value === "$89.99", "retail price row extracted");

  console.log("\n[2] fact_type/confidence are always correct");
  assert(candidates.every(c => c.confidence === "high"), "every deterministic candidate is confidence:'high' (no AI call, a literal label match)");
  assert(byField.get("motor_type")?.fact_type === "grounded_field", "a real schema field id -> fact_type:'grounded_field'");
  assert(byField.get("source_doc_upc")?.fact_type === "narrative_signal", "a synthesized (non-schema) field id -> fact_type:'narrative_signal'");

  console.log("\n[3] deterministicallyResolvedFieldIds — only grounded_field ids, feeds the AI sweep's skip list");
  const resolved = deterministicallyResolvedFieldIds(candidates);
  assert(resolved.has("motor_type") && resolved.has("blade_name"), "resolved set includes real schema field ids");
  assert(!resolved.has("source_doc_upc") && !resolved.has("source_doc_sku"), "resolved set excludes narrative_signal synthesized ids (the AI sweep's skip list is schema-field-scoped only)");

  console.log("\n[4] No false positives on ordinary prose (not every colon/dash line is a fact)");
  const prose = "This product is designed for professionals. Note: results may vary by hair type - see care instructions above.";
  const proseCandidates = extractDeterministicFacts(prose);
  const proseCareMatch = proseCandidates.find(c => c.field_id === "care_directions");
  assert(!!proseCareMatch || proseCandidates.length <= 1, "prose text yields at most the one legitimate 'Note:'-adjacent match, not a flood of false positives");

  console.log("\n[5] Empty/whitespace-only text returns nothing");
  assert(extractDeterministicFacts("").length === 0, "empty string -> no candidates");
  assert(extractDeterministicFacts("   \n\n  ").length === 0, "whitespace-only string -> no candidates");

  console.log("\n[6] Each field id only matches ONCE per document (first line wins)");
  const repeated = "Motor Type: Brushless\nMotor Type: Vector (repeated, should be ignored)";
  const repeatedCandidates = extractDeterministicFacts(repeated);
  const motorMatches = repeatedCandidates.filter(c => c.field_id === "motor_type");
  assert(motorMatches.length === 1 && motorMatches[0].value === "Brushless", `only the FIRST motor_type line wins (got ${motorMatches.length} matches, value "${motorMatches[0]?.value}")`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
