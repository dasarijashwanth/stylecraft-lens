// scripts/verify-gtm-style-exemplars.ts
// Offline regression check for "GTM Style Corpus — Real Exemplars,
// Product-Kind Awareness, Collection Kernels" (Part F). Pure-function/
// memoryDb-only — no live Rainforest/OpenAI/Gemini call, no .env.local
// loaded, so isSupabaseConfigured resolves false and hasOpenAIKey/
// hasGeminiKey both resolve false (no API keys set here). AI-backed
// derivers (collection-kernel adaptation, Core Consumer Both note
// generation) therefore can't have their AI OUTPUT exercised offline —
// this script instead verifies the deterministic mechanisms around them
// (resolution, gating, the Notes prior-wins-first ordering) directly,
// same discipline as every other verify-*.ts script in this repo.
//
// Run with: npx tsx scripts/verify-gtm-style-exemplars.ts

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
  const { GTM_STYLE_EXEMPLARS, STANDING_ANTI_COPY_WARNING, renderStyleExemplarBlock } = await import("../lib/gtm-style-exemplars");
  const { textSimilarity } = await import("../lib/text-similarity");
  const { structurallyInapplicableFieldIds } = await import("../lib/gtm-generate");
  const { deriveGoodBetterBestLineup } = await import("../lib/gtm-tier6-inference");
  const { applyDeterministicNotesConventions } = await import("../lib/gtm-notes-conventions");
  const { findCollectionByName } = await import("../lib/db/collections");
  const { resolveHeaderSku } = await import("../lib/our-product-position");
  const { getOrCreateDocument, saveDocumentFields, getDocumentFields, updateDocumentFieldMeta } = await import("../lib/db/documents");

  // ---- Section 1: Style fixture — chunk-conditional exemplar inclusion ----
  console.log("\n[1] renderStyleExemplarBlock — only attaches for style-sensitive chunks");
  const specOnlyBlock = renderStyleExemplarBlock(["motor_rpm", "motor_run_time", "charging_voltage"]);
  assert(specOnlyBlock === "", "a pure-spec chunk (no style-sensitive field) gets no exemplar corpus at all");

  const styleBlock = renderStyleExemplarBlock(["positioning_statement", "reason_to_buy"]);
  assert(styleBlock.includes(STANDING_ANTI_COPY_WARNING), "a style-sensitive chunk's block ends with the standing anti-copy warning");
  assert(GTM_STYLE_EXEMPLARS.every(ex => styleBlock.includes(ex.sku)), "every one of the 4 real exemplar SKUs appears when their fields are requested");
  assert(!styleBlock.includes("expert_tip:"), "a field with no requested id (expert_tip wasn't asked for) is not rendered into the block");

  // ---- Section 1b: anti-copy similarity — near-verbatim copy vs. distinct rewrite ----
  console.log("\n[1b] textSimilarity vs. the real exemplar corpus — the anti-copy check's own comparison basis");
  const homieClipper = GTM_STYLE_EXEMPLARS.find(ex => ex.sku === "SC628B")!;
  const exemplarReasonToBuy = homieClipper.excerpts.reason_to_buy!;
  const lightlyReworded = exemplarReasonToBuy.replace("ULTRA-QUIET OPERATION", "VERY QUIET OPERATION").replace("COMPACT NANO BODY", "SMALL NANO BODY");
  assert(textSimilarity(lightlyReworded, exemplarReasonToBuy) > 0.8, "a lightly-reworded near-copy of a real exemplar line still scores above the 0.8 anti-copy threshold");

  const genuinelyDistinct = "BRUSHLESS TORQUE CONTROL — the IN4 motor auto-adjusts power through dense, wet, or curly hair so the blade never bogs down mid-line, and a 5-hour cell means a full day of back-to-back color services without a mid-shift charge.";
  assert(textSimilarity(genuinelyDistinct, exemplarReasonToBuy) < 0.8, "genuinely distinct copy for a different product's real facts scores below the anti-copy threshold");

  // ---- Section 2: Accessory fixture — structural N/A ----
  console.log("\n[2] structurallyInapplicableFieldIds — accessory/replacement_part product_kind");
  const toolIds = structurallyInapplicableFieldIds("motor", "tool");
  assert(!toolIds.has("lever_type") && !toolIds.has("guards_type") && !toolIds.has("charging_voltage") && !toolIds.has("lids_qty"),
    "a full TOOL keeps every Lids/Lever/Guards/Charging field eligible");

  const accessoryIds = structurallyInapplicableFieldIds("motor", "accessory");
  assert(["lids_qty", "lids_colors"].every(id => accessoryIds.has(id)), "an accessory's whole Lids section is structurally N/A");
  assert(["lever_type", "lever_qty", "lever_color"].every(id => accessoryIds.has(id)), "an accessory's whole Lever section is structurally N/A");
  assert(["guards_type", "guards_qty", "guards_color"].every(id => accessoryIds.has(id)), "an accessory's whole Guards section is structurally N/A");
  assert(["charging_light_color", "charging_voltage", "charging_led_function"].every(id => accessoryIds.has(id)), "an accessory's whole Charging section is structurally N/A");
  assert(
    ["stretch_bracket_color", "axis_shield_qty", "axis_shield_color", "axis_shield_material", "axis_shield_description", "cam_follower_qty", "cam_follower_color", "cleaning_brush_qty", "cleaning_brush_color", "oil_bottle_qty", "extra_screws_qty", "extra_screws_color"].every(id => accessoryIds.has(id)),
    "the curated Included-in-Box subset is structurally N/A for an accessory"
  );
  assert(!accessoryIds.has("whats_in_box_list") && !accessoryIds.has("screw_driver_brand") && !accessoryIds.has("screw_driver_color") && !accessoryIds.has("screw_driver_other"),
    "whats_in_box_list and screw_driver_* stay eligible for an accessory (it can plausibly ship its own screwdriver/box contents)");

  const replacementPartIds = structurallyInapplicableFieldIds(undefined, "replacement_part");
  assert(replacementPartIds.has("lever_type") && replacementPartIds.has("charging_voltage"), "replacement_part gets the same non-tool exclusions as accessory");

  // ---- Section 2b: Lineup GBB derivation pools by same-product_kind siblings ----
  console.log("\n[2b] deriveGoodBetterBestLineup — pools an accessory against OTHER accessories, never full tools");
  const mixedCatalog = [
    { tool_type: "shaver", target_price: 249.95, active: true, product_kind: "tool" },
    { tool_type: "shaver", target_price: 179.95, active: true, product_kind: "tool" },
    { tool_type: "shaver", target_price: 9.95, active: true, product_kind: "accessory" },
    { tool_type: "shaver", target_price: 14.95, active: true, product_kind: "accessory" },
  ];
  const accessoryLineup = deriveGoodBetterBestLineup("shaver", 12.0, mixedCatalog, "shavers", "accessory");
  assert(!!accessoryLineup, "a $12 accessory derives a real Lineup tier when other accessories exist in the catalog");
  assert(!!accessoryLineup && !accessoryLineup.sourceDetail?.label?.includes("shavers"), "the accessory's Lineup label reflects its own pool, not the full-tool tool-type label");

  const soloAccessoryLineup = deriveGoodBetterBestLineup("shaver", 12.0, mixedCatalog.filter(p => p.product_kind === "tool"), "shavers", "accessory");
  assert(soloAccessoryLineup === null, "an accessory with zero same-product_kind siblings in the catalog gracefully returns null (today's real single-seeded-accessory state), never pooled against full-price tools");

  const toolLineup = deriveGoodBetterBestLineup("shaver", 199.95, mixedCatalog, "shavers", "tool");
  assert(!!toolLineup && (toolLineup.sourceDetail?.label || "").includes("shavers"), "a full tool still pools against other tools exactly as before (unaffected by the accessory pooling change)");

  // ---- Section 2c: deterministic Notes conventions ----
  console.log("\n[2c] applyDeterministicNotesConventions — No lever./No guards. + assembled-on-unit qty");
  const notesSchema = [
    { id: "lever_type", section: "Lever", question: "Lever Type", kind: "grounded" as const },
    { id: "guards_type", section: "Guards", question: "Guards Type", kind: "grounded" as const },
    { id: "axis_shield_qty", section: "Included in Box", question: "Axis Shield Qty", kind: "grounded" as const },
    { id: "cam_follower_qty", section: "Included in Box", question: "Cam Follower Qty", kind: "grounded" as const },
  ];
  const toolFieldsNoLeverGuards: Record<string, any> = {
    lever_type: { answer: "N/A", source: "none" },
    guards_type: { answer: "N/A", source: "none" },
    axis_shield_qty: { answer: "2 (1 assembled)", source: "web" },
    cam_follower_qty: { answer: "1 (assembled on unit)", source: "web" },
  };
  const toolSources = { project: { productName: "Test Trimmer" }, salesKit: null, tds: { lever_type: "N/A", guards_type: "N/A" }, activeReport: null } as any;
  applyDeterministicNotesConventions(toolFieldsNoLeverGuards, notesSchema, toolSources, "tool");
  assert(toolFieldsNoLeverGuards.lever_type.notes === "No lever.", "a tool-kind product with TDS-confirmed no lever gets notes = 'No lever.'");
  assert(toolFieldsNoLeverGuards.guards_type.notes === "No guards.", "a tool-kind product with TDS-confirmed no guards gets notes = 'No guards.'");
  assert(toolFieldsNoLeverGuards.axis_shield_qty.answer === "2" && toolFieldsNoLeverGuards.axis_shield_qty.notes === "(1 assembled)", "axis_shield_qty's assembled parenthetical moves out of the answer and into Notes");
  assert(toolFieldsNoLeverGuards.cam_follower_qty.answer === "1" && toolFieldsNoLeverGuards.cam_follower_qty.notes === "(assembled on unit)", "cam_follower_qty's assembled parenthetical moves out of the answer and into Notes");

  const accessoryFieldsNoLeverGuards: Record<string, any> = {
    lever_type: { answer: "N/A", source: "none" },
    guards_type: { answer: "N/A", source: "none" },
    axis_shield_qty: { answer: "N/A", source: "none" },
    cam_follower_qty: { answer: "N/A", source: "none" },
  };
  applyDeterministicNotesConventions(accessoryFieldsNoLeverGuards, notesSchema, toolSources, "accessory");
  assert(!accessoryFieldsNoLeverGuards.lever_type.notes && !accessoryFieldsNoLeverGuards.guards_type.notes,
    "an accessory does NOT get the 'No lever./No guards.' notes convention (Part B's plain structural N/A already covers it with no notes needed)");

  const realLeverFields: Record<string, any> = { lever_type: { answer: "Cam-driven adjustable lever", source: "web" } };
  applyDeterministicNotesConventions(realLeverFields, notesSchema, toolSources, "tool");
  assert(!realLeverFields.lever_type.notes, "a tool that genuinely HAS a real lever answer is never annotated 'No lever.'");

  // ---- Section 3: Collection fixture — kernel resolution (adaptation itself needs a live AI call, not exercised offline) ----
  console.log("\n[3] findCollectionByName — real seeded Homie/360 Jeezy kernels, case-insensitive");
  const homieKernel = await findCollectionByName("homie");
  assert(!!homieKernel && homieKernel.narrative_kernel.includes("Homie is a term rooted in loyalty"), "case-insensitive 'homie' resolves the real seeded Homie narrative kernel");
  const jeezyKernel = await findCollectionByName("360 Jeezy");
  assert(!!jeezyKernel && jeezyKernel.narrative_kernel.includes("full-circle approach to barbering"), "'360 Jeezy' resolves the real seeded 360 Jeezy narrative kernel");
  const noKernel = await findCollectionByName("Totally Unrelated Line");
  assert(noKernel === null, "a product line with no stored kernel resolves to null, letting generation fall back to fresh AI attempt");
  assert(homieKernel!.name !== jeezyKernel!.name && homieKernel!.narrative_kernel !== jeezyKernel!.narrative_kernel, "two different collections carry two genuinely distinct kernels (not one generic template)");

  // ---- Section 4: Core Consumer "Both" Notes — prior-wins-first ordering ----
  console.log("\n[4] saveDocumentFields — a generated Notes value fills an empty slot but never overwrites a human's own");
  const notesDoc = await getOrCreateDocument("test-style-corpus-notes-project", "gtm");
  const coreConsumerSchema = [{ id: "core_consumer", section: "General", question: "Core Consumer" }];

  await saveDocumentFields(notesDoc.id, coreConsumerSchema, { core_consumer: { answer: "Both", source: "derived", notes: "Both Pro and Retail — priced for a salon upgrade and a confident at-home user alike." } }, "system");
  let ccFields = await getDocumentFields(notesDoc.id);
  let cc = ccFields.find(f => f.field_id === "core_consumer")!;
  assert(cc.notes === "Both Pro and Retail — priced for a salon upgrade and a confident at-home user alike.", "a generated Both-note fills a genuinely empty Notes slot");

  await updateDocumentFieldMeta(notesDoc.id, "core_consumer", { notes: "Human-written reason: targets both barbershop pros and home groomers." }, "user_1");
  await saveDocumentFields(notesDoc.id, coreConsumerSchema, { core_consumer: { answer: "Both", source: "derived", notes: "A completely different regenerated reason." } }, "system");
  ccFields = await getDocumentFields(notesDoc.id);
  cc = ccFields.find(f => f.field_id === "core_consumer")!;
  assert(cc.notes === "Human-written reason: targets both barbershop pros and home groomers.", "regenerating never overwrites a human's own Notes, even when a new generated note is offered");

  // ---- Section 5: SKU-in-header prefers the linked catalog record's own sku ----
  console.log("\n[5] resolveHeaderSku — catalog record's sku wins over the project's own sku field");
  const catalogForSku = [{ id: "cp_1", name: "Test Trimmer Pro", sku: "SC999X" } as any];
  assert(resolveHeaderSku("Test Trimmer Pro", catalogForSku, "PROJECT-OWN-SKU") === "SC999X", "a catalog-linked project's header SKU comes from the catalog record, not its own sku field");
  assert(resolveHeaderSku("Some Ad-Hoc Product Nobody Catalogued", catalogForSku, "PROJECT-OWN-SKU") === "PROJECT-OWN-SKU", "a non-catalog-matched project falls back to its own sku field");
  assert(resolveHeaderSku("Some Ad-Hoc Product Nobody Catalogued", catalogForSku, null) === null, "no catalog match and no project sku resolves to null (no header suffix at all)");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
