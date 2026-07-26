// scripts/verify-legacy-brand-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// brand_categories/legacy_brands tables exist and are seeded, and that
// analyses.phase1_brand_progress exists, after the user manually runs the
// updated supabase_schema.sql. Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-legacy-brand-schema-live.ts

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

  const { data: categories, error: catErr } = await supabase.from("brand_categories").select("slug, name");
  if (catErr) {
    console.log(`✗ Table "brand_categories": ${catErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "brand_categories" exists (${categories?.length ?? 0} row(s))`);
    const expectedSlugs = ["legacy_professional_clippers", "legacy_retail_clippers", "professional_beauty", "retail_beauty"];
    for (const slug of expectedSlugs) {
      const found = categories?.some(c => c.slug === slug);
      console.log(found ? `  ✓ seeded: ${slug}` : `  ✗ MISSING: ${slug}`);
      if (!found) ok = false;
    }
  }

  const { count: brandCount, error: brandErr } = await supabase.from("legacy_brands").select("id", { count: "exact", head: true });
  if (brandErr) {
    console.log(`✗ Table "legacy_brands": ${brandErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "legacy_brands" exists (${brandCount ?? 0} row(s), expected 27)`);
    if ((brandCount ?? 0) < 27) ok = false;
  }

  const { error: colErr } = await supabase.from("analyses").select("phase1_brand_progress").limit(1);
  if (colErr) {
    console.log(`✗ analyses.phase1_brand_progress column: ${colErr.message}`);
    ok = false;
  } else {
    console.log(`✓ analyses.phase1_brand_progress column exists`);
  }

  console.log(ok ? "\nAll checks passed — the legacy brand registry is fully live." : "\nSome checks failed — see above (run the updated supabase_schema.sql).");
  process.exit(ok ? 0 : 1);
}

main();
