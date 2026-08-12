// scripts/test-amazon-product-lookup.ts
// One-off, live diagnostic for a single reported "Could not preview that
// product" support issue (ASIN B0DMXJPM4T) — calls the exact same
// getAmazonProduct() function app/api/analyses/[id]/competitors/preview/
// route.ts calls, to see precisely what Rainforest returns (or why it
// fails) for this ASIN right now. Makes ONE real, credit-costing Rainforest
// call — deliberate, not a checked-in verify-*.ts test.
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

async function main() {
  const { hasRainforestKey, getAmazonProduct } = await import("../lib/rainforest");
  console.log("hasRainforestKey:", hasRainforestKey);
  if (!hasRainforestKey) {
    console.log("No RAINFOREST_API_KEY configured in this environment — cannot test live.");
    process.exit(1);
  }

  const asin = "B0DMXJPM4T";
  console.log(`Looking up ASIN ${asin} via getAmazonProduct()...`);
  const product = await getAmazonProduct(asin);
  if (!product) {
    console.log(`RESULT: null — getAmazonProduct returned null for ${asin} (check the console.warn above for the real reason).`);
    process.exit(0);
  }
  console.log("RESULT: product found");
  console.log("  title:", product.title);
  console.log("  brand:", product.brand);
  console.log("  price:", product.price);
  console.log("  asin:", product.asin);
}

main();
