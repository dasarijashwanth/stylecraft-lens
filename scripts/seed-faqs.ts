// scripts/seed-faqs.ts
// One-time (idempotent) production content loader for the FAQ/Help center.
// Reads lib/faq-seed-data.ts (the single source of truth) and upserts each
// entry into the real `faqs` table by (category, question) — matching rows
// get their answer text refreshed (so re-running after editing the seed
// file updates content) but keep whatever enabled/sort_order the admin
// editor has since set; new rows are appended after the highest existing
// sort_order in that category, never renumbering the whole list.
//
// Run with: npx tsx scripts/seed-faqs.ts
// Requires: supabase_schema.sql's Section 15 (faqs/faq_votes/faq_search_misses)
// already applied — run scripts/verify-faq-schema-live.ts first to confirm.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { FAQ_SEED_DATA } from "../lib/faq-seed-data";

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
    console.log("No Supabase configured in this environment — cannot seed FAQ content.");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  // Cache of "next free sort_order" per category, so consecutive new
  // entries in the same category during this run stack up correctly
  // instead of colliding on the same value.
  const nextSortOrder = new Map<string, number>();

  for (const entry of FAQ_SEED_DATA) {
    const { data: existing, error: findErr } = await supabase
      .from("faqs")
      .select("id")
      .eq("category", entry.category)
      .eq("question", entry.question)
      .maybeSingle();

    if (findErr) {
      console.log(`✗ ${entry.category} / "${entry.question}": ${findErr.message}`);
      failed++;
      continue;
    }

    if (existing) {
      const { error: updateErr } = await supabase
        .from("faqs")
        .update({ answer: entry.answer, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (updateErr) {
        console.log(`✗ update failed for "${entry.question}": ${updateErr.message}`);
        failed++;
      } else {
        updated++;
      }
      continue;
    }

    if (!nextSortOrder.has(entry.category)) {
      const { data: maxRow } = await supabase
        .from("faqs")
        .select("sort_order")
        .eq("category", entry.category)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      nextSortOrder.set(entry.category, (maxRow?.sort_order ?? -1) + 1);
    }
    const sortOrder = nextSortOrder.get(entry.category)!;
    nextSortOrder.set(entry.category, sortOrder + 1);

    const { error: insertErr } = await supabase.from("faqs").insert({
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
      sort_order: sortOrder,
    });
    if (insertErr) {
      console.log(`✗ insert failed for "${entry.question}": ${insertErr.message}`);
      failed++;
    } else {
      inserted++;
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${updated} updated, ${failed} failed (of ${FAQ_SEED_DATA.length} total).`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
