// scripts/check-asin.ts
// One-off, live ASIN diagnostic — checks whether a specific ASIN resolves
// to a real Rainforest/Amazon product right now. Read-only, makes a real
// (credit-costing) Rainforest call — deliberate, not a checked-in
// verify-*.ts test. Edit ASIN at the top to reuse for a different report.
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

const ASIN = process.argv[2] || "B07P41S83V";

async function main() {
  const { getAmazonProduct, hasRainforestKey } = await import("../lib/rainforest");
  console.log("hasRainforestKey:", hasRainforestKey);
  console.log(`Checking ASIN ${ASIN}...`);
  console.log(`Direct URL: https://www.amazon.com/dp/${ASIN}`);
  const product = await getAmazonProduct(ASIN);
  if (!product) {
    console.log("\nRESULT: null — Rainforest could not resolve a real product for this ASIN right now.");
    process.exit(0);
  }
  console.log("\nRESULT: product found");
  console.log("  title:", product.title);
  console.log("  brand:", product.brand);
  console.log("  price:", product.price);
  console.log("  asin (returned):", product.asin);
}

main();
