// scripts/verify-catalog-products.ts
// Offline regression check for the StyleCraft Product Catalog feature
// (Section 34 of supabase_schema.sql / lib/db/catalog-products.ts /
// lib/catalog-import.ts / lib/our-product-position.ts). No .env.local
// loaded, so every DB-backed helper runs against memoryDb's always-seeded
// catalogProducts array — zero live Rainforest/OpenAI/Gemini calls.
//
// Run with: npx tsx scripts/verify-catalog-products.ts

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
  const { listCatalogProducts, normalizeProductName } = await import("../lib/db/catalog-products");
  const { resolveOurLineupTier } = await import("../lib/our-product-position");
  const { parseImportFile, normalizeImportRow, diffCatalogImport } = await import("../lib/catalog-import");
  const { listMotorFamilies } = await import("../lib/db/motor-families");
  const { listBrandedMotorNames } = await import("../lib/db/branded-motor-names");
  const { listHeatTechFamilies } = await import("../lib/db/heat-tech-families");
  const { listBrandedHeatTechNames } = await import("../lib/db/branded-heat-tech-names");
  const { listToolTypes } = await import("../lib/db/tool-types");

  // ─── Test 1: seed reconciliation ───────────────────────────────────────
  {
    const products = await listCatalogProducts();
    // The GTM-forms spec's own product table lists 21 distinct products —
    // its closing note ("22nd row = Infared Curler; total 22") double-counts
    // Infared Curler, which is already row 1 of the same table. All 21 real
    // rows are seeded correctly; asserting 21 here (not the spec's own
    // miscounted "22") reflects the actual distinct product list.
    assert(products.length === 73, `catalog seed produces 73 products (21 GTM-forms + 52 legacy survivors) — got ${products.length}`);

    const names = products.map(p => normalizeProductName(p.name));
    assert(new Set(names).size === names.length, "no duplicate product names in the reconciled catalog");

    const gtmCount = products.filter(p => p.source === "gtm_forms_import").length;
    const legacyCount = products.filter(p => p.source === "legacy_catalog_import").length;
    assert(gtmCount === 21, `exactly 21 products sourced from gtm_forms_import — got ${gtmCount}`);
    assert(legacyCount === 52, `exactly 52 products sourced from legacy_catalog_import — got ${legacyCount}`);

    const saberII = products.find(p => p.name === "Orange Saber II Clipper");
    assert(!!saberII && saberII.motor_family === "brushless" && saberII.motor_branded === "EON Digital Brushless", "Orange Saber II Clipper normalizes to brushless + branded \"EON Digital Brushless\"");

    const trimmer3v = products.find(p => p.name === "3versince Trimmer");
    assert(!!trimmer3v && trimmer3v.motor_family === "rotary", "3versince Trimmer normalizes to rotary");

    const curler = products.find(p => p.name === "Infared Curler");
    assert(!!curler && curler.motor_family === null && curler.heat_tech_family === "infrared" && curler.tool_type === "curling_iron", "Infared Curler is motorless, heat_tech_family 'infrared', tool_type curling_iron");

    const xceed = products.find(p => p.name === "Xceed Dryer");
    assert(!!xceed && xceed.import_flags.includes("incomplete"), "Xceed Dryer (missing price/description/motor) is flagged incomplete");

    // Regression guard for the mechanical-reconciliation bugs found and
    // fixed during implementation: combo-set products must not collapse
    // into the plain "clipper" bucket (they'd wrongly compete 1:1 against
    // standalone clippers on price/motor), and named curling-iron/flat-iron
    // products must resolve to their specific tool type, not the
    // "other_styling" catch-all.
    const comboSet = products.find(p => p.name.startsWith("Rogue Combo Set"));
    assert(!!comboSet && comboSet.tool_type === "combo", "the Rogue Combo Set (clipper+trimmer kit) is tool_type 'combo', not 'clipper'");
    const flatIron = products.find(p => p.name === "Sage Professional Flat Iron with 1\" Titanium Plates");
    assert(!!flatIron && flatIron.tool_type === "flat_iron" && flatIron.heat_tech_family === "titanium", "Sage Flat Iron resolves to tool_type flat_iron with heat_tech_family titanium");
    const curlingIron = products.find(p => p.name === "Stay-Temp Professional Ceramic Barrel 3/4\" Marcel Curling Iron");
    assert(!!curlingIron && curlingIron.tool_type === "curling_iron", "Stay-Temp Marcel Curling Iron resolves to tool_type curling_iron, not other_styling");
  }

  // ─── Test 2: catalog auto-fill data contract (Anime Trimmer) ───────────
  {
    const products = await listCatalogProducts();
    const anime = products.find(p => p.name === "Anime Trimmer");
    assert(!!anime, "Anime Trimmer exists in the catalog");
    if (anime) {
      assert(anime.industry === "grooming-barbering", "Anime Trimmer industry = grooming-barbering");
      assert(anime.target_market === "pro", "Anime Trimmer target market = pro");
      assert(anime.tool_type === "trimmer", "Anime Trimmer tool type = trimmer");
      assert(anime.target_price === 199.95, `Anime Trimmer target price = $199.95 — got ${anime.target_price}`);
      assert(!!anime.description && anime.description.includes("EON Digital brushless motor"), "Anime Trimmer description carries the full feature text");
      assert(anime.motor_family === "brushless" && anime.motor_branded === "EON Digital Brushless", "Anime Trimmer motor = brushless / \"EON Digital Brushless\" — exactly what the analyze form's catalog picker would auto-fill");
    }
  }

  // ─── Test 3: resolveOurLineupTier with explicit catalogProductId ───────
  {
    const products = await listCatalogProducts();
    const saberII = products.find(p => p.name === "Orange Saber II Clipper")!;
    const position = resolveOurLineupTier(saberII.name, products, saberII.id);
    assert(!!position, "resolveOurLineupTier resolves a position for Orange Saber II Clipper via explicit catalogProductId");
    if (position) {
      assert(position.matchedProduct?.id === saberII.id, "the resolved position's matchedProduct is the exact id-matched row, not a fuzzy name guess");
      const clipperSiblingCount = products.filter(p => p.tool_type === "clipper" && p.target_price !== null).length;
      assert(position.lineupSize === clipperSiblingCount, `lineup siblings are grouped by real tool_type (clipper), not the old loose category string — got lineupSize ${position.lineupSize}, expected ${clipperSiblingCount}`);
      assert(position.percentile > 0.75 && position.tier === "flagship", `Orange Saber II Clipper ($299.95, near the top of the clipper price range) resolves to flagship tier — got percentile ${position.percentile.toFixed(3)}, tier ${position.tier}`);
    }

    // Fuzzy-name fallback (no catalogProductId) must resolve the same product.
    const byNameOnly = resolveOurLineupTier(saberII.name, products, null);
    assert(byNameOnly?.matchedProduct?.id === saberII.id, "fuzzy name-only fallback (no catalogProductId) still resolves the same product for pre-existing analyses");
  }

  // ─── Test 4 & 5: spreadsheet re-import diff + incomplete flagging ──────
  {
    const ctx = {
      motorFamilies: await listMotorFamilies(),
      brandedMotorNames: await listBrandedMotorNames(),
      heatTechFamilies: await listHeatTechFamilies(),
      brandedHeatTechNames: await listBrandedHeatTechNames(),
      toolTypes: await listToolTypes(),
    };
    const existing = await listCatalogProducts();

    // Fixture: one existing product's price changed, one untouched
    // existing product re-listed verbatim (unchanged), and one genuinely
    // new incomplete product (missing price/description/motor).
    const csv = [
      "Name,Industry,Target Market,Tool Type,Price,Description,Motor",
      `"Orange Saber II Clipper",Grooming and barbering,Pro Barber,Clipper,349.95,"EON Digital brushless motor up to 7,200rpm, Echo blade with shallow 2.0 cutter, full metal body",EON Digital Brushless`,
      `"Anime Clipper",Grooming and barbering,Pro Barber,Clipper,249.95,"EON Digital brushless motor up to 7,800rpm, Echo taper blade with echo deep tooth cutter, ergonomic lightweight design",EON Digital Brushless`,
      `"Brand New Test Clipper",Grooming and barbering,Pro Barber,Clipper,,,`,
    ].join("\n");
    const buffer = Buffer.from(csv, "utf-8");

    const rawRows = parseImportFile(buffer);
    assert(rawRows.length === 3, `parseImportFile reads all 3 CSV data rows — got ${rawRows.length}`);

    const normalizedRows = rawRows.map(r => normalizeImportRow(r, ctx)).filter((r): r is NonNullable<typeof r> => r !== null);
    const diff = diffCatalogImport(normalizedRows, existing);

    assert(diff.changed.length === 1, `diff shows exactly 1 changed row — got ${diff.changed.length}`);
    assert(diff.changed[0]?.row.name === "Orange Saber II Clipper" && !!diff.changed[0]?.changedFields?.includes("targetPrice"), "the changed row is Orange Saber II Clipper, with targetPrice in its changedFields");
    assert(diff.unchanged.length === 1 && diff.unchanged[0]?.row.name === "Anime Clipper", "Anime Clipper (re-listed identically) is reported unchanged, not changed");
    assert(diff.new.length === 1 && diff.new[0]?.row.name === "Brand New Test Clipper", "the genuinely new row is reported under 'new'");
    assert(!!diff.new[0]?.row.importFlags.includes("incomplete"), "the new row (missing price/description/motor) is flagged incomplete at import time");
    assert(diff.missingFromFile.length === existing.length - 2, "every existing product not present in the file is reported missingFromFile (informational only — never deleted)");
  }

  // ─── Test 6: tool type inferred from product name/description when the
  // spreadsheet's own "Tool Type" column is blank or unresolvable ─────────
  {
    const ctx = {
      motorFamilies: await listMotorFamilies(),
      brandedMotorNames: await listBrandedMotorNames(),
      heatTechFamilies: await listHeatTechFamilies(),
      brandedHeatTechNames: await listBrandedHeatTechNames(),
      toolTypes: await listToolTypes(),
    };

    const csv = [
      "Name,Industry,Target Market,Tool Type,Price,Description,Motor",
      `"Awesome New Trimmer",Grooming and barbering,Pro Barber,,229.95,"Zero-gap blade, 3-hour cordless runtime",EON Digital Brushless`,
      `"Totally Unrecognizable Widget",Grooming and barbering,Pro Barber,,49.95,"Does something, has parts",`,
    ].join("\n");
    const buffer = Buffer.from(csv, "utf-8");
    const rawRows = parseImportFile(buffer);
    const normalizedRows = rawRows.map(r => normalizeImportRow(r, ctx)).filter((r): r is NonNullable<typeof r> => r !== null);

    const trimmerRow = normalizedRows.find(r => r.name === "Awesome New Trimmer");
    assert(!!trimmerRow, "the trimmer row parses");
    assert(trimmerRow?.toolType === "trimmer", `a blank Tool Type column resolves from the product's own Name ("Trimmer") — got ${trimmerRow?.toolType}`);
    assert(!!trimmerRow?.importFlags.includes("tool_type_inferred_from_product"), "the inferred-from-product-text case is flagged for admin confirmation, not silently trusted");
    assert(!trimmerRow?.importFlags.includes("tool_type_needs_review"), "a successfully-inferred tool type is never ALSO flagged needs_review");

    const widgetRow = normalizedRows.find(r => r.name === "Totally Unrecognizable Widget");
    assert(!!widgetRow, "the widget row parses");
    assert(widgetRow?.toolType === null, "a product with no resolvable tool-type vocabulary anywhere (column, name, or description) stays null rather than a guess");
    assert(!!widgetRow?.importFlags.includes("tool_type_needs_review"), "the genuinely-unresolvable case is flagged needs_review");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
