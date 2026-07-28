// scripts/verify-deck-run-merge.ts
// Offline, pure-string assertions for lib/deck-run-merge.ts — no live API
// calls, no zip/file I/O. Synthetic <a:p> paragraph XML fixtures mimic the
// exact shape PowerPoint produces (a:r/a:rPr/a:t), including realistic
// split-run cases the real production template hit.
//
// Run with: npx tsx scripts/verify-deck-run-merge.ts

import { mergeRunsInParagraph, mergeSplitTokensInXml } from "../lib/deck-run-merge";

let passed = 0;
let failed = 0;

function assertEqual(actual: string, expected: string, label: string) {
  if (actual === expected) {
    console.log(`PASS: ${label}`);
    passed++;
  } else {
    console.log(`FAIL: ${label}`);
    console.log(`  expected: ${expected}`);
    console.log(`  actual:   ${actual}`);
    failed++;
  }
}

function assertContains(actual: string, needle: string, label: string) {
  if (actual.includes(needle)) {
    console.log(`PASS: ${label}`);
    passed++;
  } else {
    console.log(`FAIL: ${label} — expected to find: ${needle}`);
    console.log(`  actual: ${actual}`);
    failed++;
  }
}

// 1. A token split across 3 runs, all sharing identical rPr — the exact
// real-world case (autocomplete/spell-check boundary mid-tag).
{
  const p =
    `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>{{</a:t></a:r>` +
    `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>product_title</a:t></a:r>` +
    `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>}}</a:t></a:r></a:p>`;
  const merged = mergeRunsInParagraph(p);
  assertContains(merged, "<a:t>{{product_title}}</a:t>", "3-way split token merges into one run");
  // Only one <a:r> should remain in the paragraph.
  const runCount = (merged.match(/<a:r>/g) || []).length;
  assertEqual(String(runCount), "1", "3-way split collapses to exactly one <a:r>");
}

// 2. A token NOT split (already a single run) — must be left byte-for-byte
// untouched (no spurious rewrite of already-correct XML).
{
  const p = `<a:p><a:r><a:rPr lang="en-US"/><a:t>{{price}}</a:t></a:r></a:p>`;
  assertEqual(mergeRunsInParagraph(p), p, "already-contiguous token is untouched");
}

// 3. Surrounding, unrelated prose runs with DIFFERENT formatting must be
// preserved exactly — the merge must be targeted to only the token span,
// never bleed into neighboring real content (template fidelity).
{
  const p =
    `<a:p>` +
    `<a:r><a:rPr b="1"/><a:t>StyleCraft</a:t></a:r>` +
    `<a:r><a:rPr/><a:t> presents {{</a:t></a:r>` +
    `<a:r><a:rPr/><a:t>project_name</a:t></a:r>` +
    `<a:r><a:rPr/><a:t>}}</a:t></a:r>` +
    `<a:r><a:rPr i="1"/><a:t> — final</a:t></a:r>` +
    `</a:p>`;
  const merged = mergeRunsInParagraph(p);
  assertContains(merged, `<a:r><a:rPr b="1"/><a:t>StyleCraft</a:t></a:r>`, "unrelated bold run before token untouched");
  assertContains(merged, `<a:r><a:rPr i="1"/><a:t> — final</a:t></a:r>`, "unrelated italic run after token untouched");
  assertContains(merged, "{{project_name}}", "token in the middle is recovered despite unrelated neighbors");
}

// 4. Loop delimiters ({{#x}} / {{/x}}) each split across runs independently.
{
  const p =
    `<a:p><a:r><a:rPr/><a:t>{{#</a:t></a:r><a:r><a:rPr/><a:t>competitor_table</a:t></a:r><a:r><a:rPr/><a:t>}}</a:t></a:r></a:p>` +
    `<a:p><a:r><a:rPr/><a:t>{{name}}</a:t></a:r></a:p>` +
    `<a:p><a:r><a:rPr/><a:t>{{/</a:t></a:r><a:r><a:rPr/><a:t>competitor_table}}</a:t></a:r></a:p>`;
  const merged = mergeSplitTokensInXml(p);
  assertContains(merged, "{{#competitor_table}}", "loop open delimiter recovered across full xml");
  assertContains(merged, "{{/competitor_table}}", "loop close delimiter recovered across full xml");
}

// 5. Multiple independent tokens split in the SAME paragraph must each
// merge correctly without interfering with each other.
{
  const p =
    `<a:p>` +
    `<a:r><a:rPr/><a:t>{{</a:t></a:r><a:r><a:rPr/><a:t>usp_1</a:t></a:r><a:r><a:rPr/><a:t>}}</a:t></a:r>` +
    `<a:r><a:rPr/><a:t> and </a:t></a:r>` +
    `<a:r><a:rPr/><a:t>{{</a:t></a:r><a:r><a:rPr/><a:t>usp_2</a:t></a:r><a:r><a:rPr/><a:t>}}</a:t></a:r>` +
    `</a:p>`;
  const merged = mergeRunsInParagraph(p);
  assertContains(merged, "{{usp_1}}", "first of two split tokens in one paragraph recovered");
  assertContains(merged, "{{usp_2}}", "second of two split tokens in one paragraph recovered");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
