// scripts/verify-emoji-strip.ts
// Offline verification of lib/emoji-strip.ts — emoji must never survive
// into a saved document field (GTM/TDS/Content Form), per the brand
// typography spec's icon-system rules. See lib/db/documents.ts's
// saveDocumentFields for where this is actually wired in.
//
// Run with: npx tsx scripts/verify-emoji-strip.ts
import { containsEmoji, stripEmoji } from "../lib/emoji-strip";

let passed = 0;
let failed = 0;

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`✗ FAILED: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(actual: boolean, label: string) {
  assertEqual(actual, true, label);
}

// containsEmoji — real detections
assertTrue(containsEmoji("Great for daily use \u{1F525}"), "detects fire emoji");
assertTrue(containsEmoji("Ships fast \u{1F680}"), "detects rocket emoji");
assertTrue(containsEmoji("✅ Verified"), "detects check-mark emoji (dingbat range)");
assertTrue(containsEmoji("Family \u{1F468}‍\u{1F469}‍\u{1F467}"), "detects ZWJ-joined family emoji sequence");
assertTrue(containsEmoji("Thumbs up \u{1F44D}\u{1F3FD}"), "detects emoji + skin-tone modifier");

// containsEmoji — must NOT false-positive on ordinary generated-copy punctuation
assertEqual(containsEmoji("Cordless design · 2-year warranty"), false, "does not flag middle-dot separator");
assertEqual(containsEmoji("Weight: 1.2lbs — lightweight build"), false, "does not flag em dash");
assertEqual(containsEmoji("30% faster × dry time"), false, "does not flag multiplication sign");
assertEqual(containsEmoji("Rated 4.5/5 stars"), false, "does not flag plain ASCII text");
assertEqual(containsEmoji(""), false, "empty string has no emoji");

// stripEmoji — removes emoji, collapses resulting double-spaces, trims
assertEqual(stripEmoji("Great for daily use \u{1F525}"), "Great for daily use", "strips trailing emoji + trims");
assertEqual(stripEmoji("\u{1F680} Ships fast"), "Ships fast", "strips leading emoji + trims");
assertEqual(stripEmoji("Ships \u{1F680} fast"), "Ships fast", "strips mid-string emoji + collapses double space");
assertEqual(stripEmoji("No emoji here"), "No emoji here", "leaves clean text untouched (same reference-safe value)");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
