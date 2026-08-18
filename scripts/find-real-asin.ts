// scripts/find-real-asin.ts
// One-off — live Rainforest search to find the real, currently-listed ASIN
// for a specific named product (used to fix a broken hardcoded ASIN in
// lib/analysisEngine.ts's getCategoryFallbackCompetitors static fallback
// data). Read-only, makes real (credit-costing) Rainforest calls.
import { readFileSync } from "fs";
import { resolve } from "path";

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

const QUERY = process.argv[2] || "BaBylissPRO GoldFX Outlining Clipper";

async function main() {
  const { searchAmazonCategory, getAmazonProduct } = await import("../lib/rainforest");
  console.log(`Searching: "${QUERY}"`);
  const results = await searchAmazonCategory(QUERY, 8);
  if (results.length === 0) {
    console.log("No search results at all.");
    process.exit(0);
  }
  for (const r of results) {
    console.log(`  ${r.asin} | ${r.title} | ${r.price} | rating=${r.rating} reviews=${r.reviewsTotal}`);
  }

  console.log("\nFull detail for top 3:");
  for (const r of results.slice(0, 3)) {
    const p = await getAmazonProduct(r.asin);
    if (!p) { console.log(`${r.asin}: detail lookup failed`); continue; }
    console.log(`\n${r.asin} | ${p.title}`);
    console.log(`  brand=${p.brand} price=${p.price} rating=${p.rating_str} reviews=${p.reviews_str} bsr=${p.bsr}`);
  }
}

main();
