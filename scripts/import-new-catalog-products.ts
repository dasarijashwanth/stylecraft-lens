// scripts/import-new-catalog-products.ts
// One-off script (run by hand, not part of the normal dev loop — same
// category as scripts/seed-faqs.ts). Adds newly-found stylecraftus.com
// products to catalog_products and seeds missing collection narrative
// kernels — additive only, never touches an existing row.
//
// Deliberately does NOT import lib/db/catalog-products.ts / lib/db/
// collections.ts: those transitively import lib/supabase.ts, whose
// `isSupabaseConfigured`/`supabaseAdmin` are computed at MODULE EVALUATION
// time — before this script's own .env.local loading below ever runs,
// which silently routes everything into the ephemeral memoryDb mock
// instead of the real database. Same reason scripts/seed-faqs.ts and
// scripts/create-admin-user.ts construct their own createClient() directly
// rather than importing any lib/db/*.ts module.
//
// IMPORTANT: of the 11 products originally requested for this pass, 10
// were found (verified live against stylecraftus.com, not guessed) to
// already exist in catalog_products under fuller descriptive names — the
// catalog's own convention appends the motor/tech spec to the name (e.g.
// "Reign Professional Hair Clipper" is already there as "Reign
// Professional Hair Clipper with EON Digital Brushless Motor"). Only
// "Homie Nano Single Foil Shaver" (SC817B) is genuinely new. See the
// SKIPPED list below for the full verified mapping.
//
// Run with: npx tsx scripts/import-new-catalog-products.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import path from "path";

const envPath = path.resolve(__dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  console.log("Loaded .env.local\n");
}

const SKIPPED_AS_ALREADY_CATALOGED = [
  { requested: "Saber Professional Hair Trimmer", existingAs: "Saber Professional Hair Trimmer with Digital Brushless Motor" },
  { requested: "Saber 2 Professional Hair Clipper", existingAs: "Saber 2 Professional Hair Clipper with EON Digital Brushless Motor" },
  { requested: "Instinct Metal Professional Double Foil Shaver", existingAs: "Instinct Metal Professional Double Foil Shaver with IN2 Vector Motor" },
  { requested: "Instinct Metal Professional Hair Clipper", existingAs: "Instinct Metal Professional Hair Clipper with IN2 Vector Motor" },
  { requested: "Reign Professional Hair Clipper", existingAs: "Reign Professional Hair Clipper with EON Digital Brushless Motor" },
  { requested: "Reign Professional Hair Trimmer", existingAs: "Reign Professional Hair Trimmer with EON Digital Brushless Motor" },
  { requested: "Sage Curling Iron & Wand", existingAs: 'Sage Professional 1" Cordless Curling Iron & Wand with Removable Clamp' },
  { requested: "Ace Professional Hair Dryer", existingAs: 'Ace Professional Lightweight Foldable Hair Dryer (site displays it as "Ace Professional Hair Dryer" — confirmed same product)' },
  { requested: "Sage 2-in-1 Diffuser & Hair Dryer", existingAs: "Sage 2-in-1 Diffuser & Hair Dryer with Ion Generator" },
  { requested: "Sage Professional Hair Dryer", existingAs: "Sage Professional Lightweight Hair Dryer with Digital LED Display (verified same spec tier: 1600W brushless, 105,000 RPM, Ion)" },
];

const NEW_COLLECTION_TAGLINES: Record<string, string> = {
  Saber: "HIGH ENERGY, LOW VIBRATION.",
  Instinct: "UNMATCHED. UNSTOPPABLE. INTUITIVE.",
  Reign: "CONQUER EVERY STYLE.",
  Sage: "STYLE WITH WISDOM. SHINE WITH CONFIDENCE.",
  Rogue: "EMBRACE THE UNCONVENTIONAL: GO ROGUE!",
  Ace: "ACE THE PERFECT CUT.",
  Rebel: "REBEL WITH A CAUSE.",
  "Protégé": "ELEVATE YOUR POTENTIAL.",
  Uno: "SMALL IN SIZE, POWERFUL SHAVE.",
  Flex: "WHERE INNOVATION MEETS VERSATILITY.",
  // Homie already has a full kernel row (seedCollectionDefaults) — not touched.
};

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot run against the live project.");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log("=== Catalog product import ===\n");
  console.log(`Skipping ${SKIPPED_AS_ALREADY_CATALOGED.length} products already cataloged (verified live against stylecraftus.com):`);
  for (const s of SKIPPED_AS_ALREADY_CATALOGED) {
    console.log(`  - "${s.requested}" -> already exists as "${s.existingAs}"`);
  }

  console.log("\nAdding genuinely new products...");
  const NEW_NAME = "Homie Nano Single Foil Shaver";
  const { data: existingRows, error: existingErr } = await supabase.from("catalog_products").select("id, name");
  if (existingErr) throw existingErr;
  const alreadyThere = (existingRows || []).find(r => normalizeProductName(r.name) === normalizeProductName(NEW_NAME));

  if (alreadyThere) {
    console.log(`  - "${NEW_NAME}" already exists (id=${alreadyThere.id}) — skipping (script re-run safety).`);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("catalog_products")
      .insert({
        name: NEW_NAME,
        industry: "grooming-barbering",
        target_market: "pro",
        tool_type: "shaver",
        target_price: 34.95,
        description: "8,500 RPM motor, Gold Titanium Foil, pocket-sized finishing shaver. Currently pre-order (next drop: September) per stylecraftus.com.",
        // Site states RPM but no explicit motor family/brand name for this
        // SKU — left null rather than guessing "likely Brushless" (the
        // ticket's own hedge-worded guess), per this codebase's "never
        // guess a taxonomy match" discipline.
        motor_family: null,
        motor_branded: null,
        brand: "StyleCraft",
        sku: "SC817B",
        collection: "Homie",
        import_flags: ["motor_needs_confirmation", "preorder_not_yet_shipping"],
        source: "site_harvest_2026-08-09",
      })
      .select()
      .single();
    if (insertErr) throw insertErr;
    console.log(`  + Added "${inserted.name}" (id=${inserted.id}, sku=SC817B, $34.95)`);
  }

  console.log("\nSeeding missing collection narrative kernels...");
  const { data: existingCollections, error: collErr } = await supabase.from("collections").select("name, sort_order").order("sort_order", { ascending: false });
  if (collErr) throw collErr;
  const existingCollectionNames = new Set((existingCollections || []).map(c => c.name.trim().toLowerCase()));
  let nextSort = (existingCollections?.[0]?.sort_order ?? -1) + 1;

  for (const [name, tagline] of Object.entries(NEW_COLLECTION_TAGLINES)) {
    if (existingCollectionNames.has(name.trim().toLowerCase())) {
      console.log(`  - "${name}" already has a kernel row — skipping.`);
      continue;
    }
    const { data: row, error } = await supabase
      .from("collections")
      .insert({ name, narrative_kernel: tagline, logo_meaning: "", voice_notes: "", sort_order: nextSort })
      .select()
      .single();
    if (error) throw error;
    nextSort++;
    console.log(`  + Added collection kernel "${row.name}": "${tagline}"`);
  }

  console.log("\n=== Import complete ===");
  console.log(`Added: up to 1 new catalog product, up to ${Object.keys(NEW_COLLECTION_TAGLINES).length} new collection kernels.`);
  console.log(`Skipped (already cataloged): ${SKIPPED_AS_ALREADY_CATALOGED.length} products.`);
  console.log("Zero existing catalog_products or collections rows were modified.");
  process.exit(0);
}

main().catch(err => {
  console.error("Import script failed:", err);
  process.exit(1);
});
