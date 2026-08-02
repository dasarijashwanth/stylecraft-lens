// scripts/verify-catalog-products-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// catalog_products table (Section 34 of supabase_schema.sql) exists and is
// seeded with the reconciled 73-product catalog, and that the same
// section's heat_tech_families 'infrared' row + 6 StyleCraft
// branded_motor_names rows are live. Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-catalog-products-schema-live.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.substring(0, index).trim();
    let val = trimmed.substring(index + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    process.env[key] = val;
  });
  console.log("Loaded .env.local\n");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("No Supabase configured in this environment — cannot verify live schema.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let ok = true;

  console.log("--- catalog_products (Section 34) ---");
  const { data: products, error: productsError } = await supabase
    .from("catalog_products")
    .select("id, name, industry, target_market, tool_type, target_price, motor_family, motor_branded, heat_tech_family, heat_tech_branded, active, import_flags, source");
  if (productsError) {
    console.log(`✗ Table "catalog_products": ${productsError.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "catalog_products" exists — ${products?.length ?? 0} rows`);
    const gtmCount = (products || []).filter(p => p.source === "gtm_forms_import").length;
    const legacyCount = (products || []).filter(p => p.source === "legacy_catalog_import").length;
    if ((products?.length ?? 0) === 73 && gtmCount === 21 && legacyCount === 52) {
      console.log(`✓ Seed counts match: ${gtmCount} gtm_forms_import + ${legacyCount} legacy_catalog_import = ${products!.length}`);
    } else {
      console.log(`✗ Seed counts off — expected 21 gtm_forms_import + 52 legacy_catalog_import = 73, got ${gtmCount} + ${legacyCount} = ${products?.length ?? 0}`);
      ok = false;
    }

    const saberII = (products || []).find(p => p.name === "Orange Saber II Clipper");
    if (saberII && saberII.motor_family === "brushless" && saberII.motor_branded === "EON Digital Brushless") {
      console.log('✓ "Orange Saber II Clipper" normalizes to brushless + branded "EON Digital Brushless"');
    } else {
      console.log(`✗ "Orange Saber II Clipper" motor normalization mismatch — got motor_family=${saberII?.motor_family}, motor_branded=${saberII?.motor_branded}`);
      ok = false;
    }

    const comboSet = (products || []).find(p => p.name.startsWith("Rogue Combo Set"));
    if (comboSet && comboSet.tool_type === "combo") {
      console.log('✓ "Rogue Combo Set" is tool_type combo (not the plain clipper bucket)');
    } else {
      console.log(`✗ "Rogue Combo Set" tool_type mismatch — got ${comboSet?.tool_type}`);
      ok = false;
    }
  }

  console.log("\n--- heat_tech_families 'infrared' row (Section 34) ---");
  const { data: heatFamily, error: heatFamilyError } = await supabase
    .from("heat_tech_families")
    .select("family_key, label, aliases")
    .eq("family_key", "infrared")
    .maybeSingle();
  if (heatFamilyError || !heatFamily) {
    console.log(`✗ heat_tech_families 'infrared' row: ${heatFamilyError?.message || "not found"}`);
    ok = false;
  } else {
    console.log(`✓ heat_tech_families 'infrared' row exists — aliases: ${(heatFamily.aliases || []).join(", ")}`);
  }

  console.log("\n--- branded_motor_names StyleCraft rows (Section 34) ---");
  const { data: brandedNames, error: brandedNamesError } = await supabase
    .from("branded_motor_names")
    .select("branded_term, family_key")
    .eq("brand_name", "StyleCraft");
  if (brandedNamesError) {
    console.log(`✗ branded_motor_names StyleCraft rows: ${brandedNamesError.message}`);
    ok = false;
  } else if ((brandedNames?.length ?? 0) >= 6) {
    console.log(`✓ branded_motor_names has ${brandedNames!.length} StyleCraft rows (expected >= 6)`);
  } else {
    console.log(`✗ branded_motor_names StyleCraft rows — expected >= 6, got ${brandedNames?.length ?? 0}`);
    ok = false;
  }

  console.log(ok ? "\nAll checks passed — the Product Catalog feature is fully live." : "\nSome checks failed — run the updated supabase_schema.sql (Section 34).");
  process.exit(ok ? 0 : 1);
}

main();
