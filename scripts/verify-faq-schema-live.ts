// scripts/verify-faq-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// faqs/faq_votes/faq_search_misses tables and profiles.faq_banner_dismissed_at
// column exist after the user manually runs the updated supabase_schema.sql,
// and (once scripts/seed-faqs.ts has been run) that content is seeded across
// all 12 categories. Zero writes, zero AI/Rainforest calls.
//
// Run with: npx tsx scripts/verify-faq-schema-live.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { FAQ_CATEGORIES, FAQ_SEED_DATA } from "../lib/faq-seed-data";

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

  const { data: faqs, error: faqErr } = await supabase.from("faqs").select("category, question");
  if (faqErr) {
    console.log(`✗ Table "faqs": ${faqErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "faqs" exists (${faqs?.length ?? 0} row(s), expected ${FAQ_SEED_DATA.length}+)`);
    for (const category of FAQ_CATEGORIES) {
      const count = faqs?.filter(f => f.category === category).length ?? 0;
      console.log(count > 0 ? `  ✓ seeded: ${category} (${count})` : `  ✗ MISSING: ${category}`);
      if (count === 0) ok = false;
    }
    if ((faqs?.length ?? 0) < FAQ_SEED_DATA.length) {
      console.log(`  ✗ fewer rows (${faqs?.length ?? 0}) than seed data (${FAQ_SEED_DATA.length}) — run scripts/seed-faqs.ts`);
      ok = false;
    }
  }

  const { error: voteErr } = await supabase.from("faq_votes").select("id").limit(1);
  if (voteErr) {
    console.log(`✗ Table "faq_votes": ${voteErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "faq_votes" exists`);
  }

  const { error: missErr } = await supabase.from("faq_search_misses").select("id").limit(1);
  if (missErr) {
    console.log(`✗ Table "faq_search_misses": ${missErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "faq_search_misses" exists`);
  }

  const { error: colErr } = await supabase.from("profiles").select("faq_banner_dismissed_at").limit(1);
  if (colErr) {
    console.log(`✗ profiles.faq_banner_dismissed_at column: ${colErr.message}`);
    ok = false;
  } else {
    console.log(`✓ profiles.faq_banner_dismissed_at column exists`);
  }

  console.log(ok ? "\nAll checks passed — the FAQ/Help system is fully live." : "\nSome checks failed — see above.");
  process.exit(ok ? 0 : 1);
}

main();
