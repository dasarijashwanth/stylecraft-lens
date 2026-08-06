// scripts/verify-related-products-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// two new columns from supabase_schema.sql's Sections 51-52
// (analyses.related_products, projects.related_products) exist and default
// to an empty JSONB array. Zero writes, zero AI/Rainforest calls. Run this
// AFTER applying Sections 51-52 by hand in the Supabase SQL editor.
//
// Run with: npx tsx scripts/verify-related-products-schema-live.ts

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

  console.log("--- analyses.related_products (Section 51) ---");
  const { data: analysesRows, error: analysesError } = await supabase
    .from("analyses")
    .select("id, related_products")
    .limit(1);
  if (analysesError) {
    console.log(`✗ Column "analyses.related_products": ${analysesError.message}`);
    ok = false;
  } else {
    console.log(`✓ Column "analyses.related_products" is queryable`);
    if (analysesRows && analysesRows.length > 0) {
      const value = analysesRows[0].related_products;
      if (Array.isArray(value)) {
        console.log(`✓ Existing row's related_products defaults to an array (${value.length} entries)`);
      } else {
        console.log(`✗ Existing row's related_products is not an array — got ${JSON.stringify(value)}`);
        ok = false;
      }
    } else {
      console.log("  (no existing analyses rows to sample a default value from — column presence alone confirmed)");
    }
  }

  console.log("\n--- projects.related_products (Section 52) ---");
  const { data: projectsRows, error: projectsError } = await supabase
    .from("projects")
    .select("id, related_products")
    .limit(1);
  if (projectsError) {
    console.log(`✗ Column "projects.related_products": ${projectsError.message}`);
    ok = false;
  } else {
    console.log(`✓ Column "projects.related_products" is queryable`);
    if (projectsRows && projectsRows.length > 0) {
      const value = projectsRows[0].related_products;
      if (Array.isArray(value)) {
        console.log(`✓ Existing row's related_products defaults to an array (${value.length} entries)`);
      } else {
        console.log(`✗ Existing row's related_products is not an array — got ${JSON.stringify(value)}`);
        ok = false;
      }
    } else {
      console.log("  (no existing project rows to sample a default value from — column presence alone confirmed)");
    }
  }

  console.log(ok ? "\nAll checks passed — the Related Products schema is fully live." : "\nSome checks failed — run supabase_schema.sql's Sections 51-52 in the Supabase SQL editor.");
  process.exit(ok ? 0 : 1);
}

main();
