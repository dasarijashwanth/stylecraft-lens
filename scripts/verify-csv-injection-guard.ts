// scripts/verify-csv-injection-guard.ts
// Offline verification of lib/csv-safe.ts's formula-injection guard, used
// by both the GTM CSV export route and the competitors page's bulk CSV
// export (the latter had NO guard at all before this pass — a competitor
// name/brand/model-number starting with =, +, -, or @ would be
// interpreted as a live formula by Excel/Sheets on open).
//
// Run with: npx tsx scripts/verify-csv-injection-guard.ts
import { sanitizeCsvCell } from "../lib/csv-safe";

let passed = 0;
let failed = 0;

function assertEqual(actual: string, expected: string, label: string) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`✗ FAILED: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// Dangerous prefixes get defused with a leading single quote
assertEqual(sanitizeCsvCell("=1+1"), "'=1+1", "= formula");
assertEqual(sanitizeCsvCell("=HYPERLINK(\"http://evil.com\",\"click\")"), "'=HYPERLINK(\"http://evil.com\",\"click\")", "HYPERLINK formula");
assertEqual(sanitizeCsvCell("+1234567890"), "'+1234567890", "+ prefix");
assertEqual(sanitizeCsvCell("-2000X"), "'-2000X", "- prefix (a plausible real model number)");
assertEqual(sanitizeCsvCell("@SUM(A1:A10)"), "'@SUM(A1:A10)", "@ prefix");
assertEqual(sanitizeCsvCell("=cmd|'/C calc'!A1"), "'=cmd|'/C calc'!A1", "DDE/cmd-launch payload");

// Safe values pass through unchanged
assertEqual(sanitizeCsvCell("Wahl Professional"), "Wahl Professional", "plain brand name");
assertEqual(sanitizeCsvCell("$249.99"), "$249.99", "price string (not a formula prefix)");
assertEqual(sanitizeCsvCell(""), "", "empty string");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
