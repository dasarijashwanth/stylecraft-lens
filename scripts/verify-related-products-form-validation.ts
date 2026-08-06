// scripts/verify-related-products-form-validation.ts
// Offline regression check for lib/asin-parse-client.ts's resolveAsinLocal
// (the analyze form's "Related Products" field client-side validation) —
// pure regex logic, no network, no React rendering needed.
//
// Run with: npx tsx scripts/verify-related-products-form-validation.ts

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
  const { resolveAsinLocal } = await import("../lib/asin-parse-client");

  console.log("\n[1] Bare ASIN (raw, 10 alphanumeric chars)");
  assert(resolveAsinLocal("B0CLPR1234") === "B0CLPR1234", "valid bare ASIN resolves as-is (uppercased)");
  assert(resolveAsinLocal("b0clpr1234") === "B0CLPR1234", "lowercase bare ASIN uppercases");
  assert(resolveAsinLocal("  B0CLPR1234  ") === "B0CLPR1234", "surrounding whitespace is trimmed");

  console.log("\n[2] Full Amazon URLs");
  assert(resolveAsinLocal("https://www.amazon.com/dp/B0CLPR1234") === "B0CLPR1234", "/dp/{ASIN} URL resolves");
  assert(resolveAsinLocal("https://www.amazon.com/Some-Product-Name/dp/B0CLPR1234/ref=sr_1_1") === "B0CLPR1234", "/dp/{ASIN} URL with trailing query/ref segments still resolves");
  assert(resolveAsinLocal("https://www.amazon.com/gp/product/B0CLPR1234") === "B0CLPR1234", "/gp/product/{ASIN} URL resolves");
  assert(resolveAsinLocal("https://www.amazon.com/gp/product/b0clpr1234?th=1") === "B0CLPR1234", "/gp/product/{ASIN} lowercase + query string resolves and uppercases");

  console.log("\n[3] Invalid/unfetchable input");
  assert(resolveAsinLocal("") === null, "empty string -> null");
  assert(resolveAsinLocal("   ") === null, "whitespace-only -> null");
  assert(resolveAsinLocal("not a real url or asin") === null, "plain garbage text -> null");
  assert(resolveAsinLocal("B0SHORT") === null, "too-short ASIN-like string -> null");
  assert(resolveAsinLocal("B0TOOLONGASIN123") === null, "too-long ASIN-like string -> null");
  assert(resolveAsinLocal("https://www.amazon.com/s?k=clippers") === null, "a search-results URL (no /dp/ or /gp/product/) -> null");

  console.log("\n[4] Duplicate-across-rows detection (plain equality once resolved)");
  const rowAsins = [resolveAsinLocal("B0CLPR1234"), resolveAsinLocal("https://www.amazon.com/dp/b0clpr1234"), resolveAsinLocal("B0OTHER123")];
  const duplicateCheck = rowAsins.some((a, i) => i !== 0 && a === rowAsins[0]);
  assert(duplicateCheck, "the same product pasted as a bare ASIN in one row and a full URL in another resolves to an equal ASIN, catchable as a duplicate");
  assert(rowAsins[0] !== rowAsins[2], "genuinely different products never falsely flag as duplicates");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
