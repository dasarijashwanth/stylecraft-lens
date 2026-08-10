// scripts/verify-zip-safety.ts
// Security audit — regression coverage for lib/zip-safety.ts's zip-bomb
// guard, wired into lib/tds-doc-extract.ts (XLSX/DOCX), lib/gtm-workbook-
// template-parser.ts, and lib/deck-template-parser.ts. Pure offline —
// builds real small zips with PizZip, no live calls.
// Run with: npx tsx scripts/verify-zip-safety.ts

import PizZip from "pizzip";
import { assertZipSafe, isZipSafe, ZipBombError } from "../lib/zip-safety";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function buildZip(files: { name: string; content: string }[]): Buffer {
  const zip = new PizZip();
  for (const f of files) zip.file(f.name, f.content);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

async function main() {
  console.log("[1] A normal, small zip passes cleanly");
  {
    const buf = buildZip([{ name: "doc.xml", content: "<root>hello world</root>" }]);
    assert(isZipSafe(buf), "a tiny well-formed zip with real content is not flagged");
  }

  console.log("\n[2] A zip with many entries is rejected");
  {
    const files = Array.from({ length: 2500 }, (_, i) => ({ name: `f${i}.xml`, content: "x" }));
    const buf = buildZip(files);
    let threw = false;
    try {
      assertZipSafe(buf);
    } catch (e) {
      threw = e instanceof ZipBombError;
    }
    assert(threw, "a zip with 2500 entries (over the 2000 cap) throws ZipBombError");
  }

  console.log("\n[3] A single entry claiming a huge uncompressed size is rejected");
  {
    // Real DEFLATE compression of a highly-repetitive string achieves large
    // ratios cheaply — build a real entry whose reported uncompressedSize
    // exceeds the single-entry cap without needing gigabytes of real input.
    const repeated = "A".repeat(5_000_000); // 5MB of one repeated byte — compresses to almost nothing
    const buf = buildZip([{ name: "bomb.xml", content: repeated }]);
    // Confirm the real compression ratio achieved is large enough to prove
    // this is a realistic bomb shape, not just a big legitimate file.
    const zip = new PizZip(buf);
    const entry: any = (zip.files as any)["bomb.xml"];
    const ratio = entry._data.uncompressedSize / Math.max(1, entry._data.compressedSize);
    assert(ratio > 300, `a real 5MB-of-one-byte entry compresses at a bomb-like ratio (got ${Math.round(ratio)}:1)`);
    let threw = false;
    let message = "";
    try {
      assertZipSafe(buf);
    } catch (e) {
      threw = e instanceof ZipBombError;
      message = (e as Error).message;
    }
    assert(threw, "a suspicious-compression-ratio entry throws ZipBombError before any real decompression");
    assert(/ratio/i.test(message), `the error message names the ratio as the reason (got: ${message})`);
  }

  console.log("\n[4] ZipBombError carries status:400 so route catch blocks report a client error, not a 500");
  {
    const err = new ZipBombError("test");
    assert((err as any).status === 400, "ZipBombError.status is 400");
  }

  console.log("\n[5] assertZipSafe accepts an already-open PizZip instance (no re-parse needed)");
  {
    const buf = buildZip([{ name: "a.xml", content: "hello" }]);
    const zip = new PizZip(buf);
    let threw = false;
    try {
      assertZipSafe(zip);
    } catch {
      threw = true;
    }
    assert(!threw, "passing an already-constructed PizZip instance works identically to passing the raw buffer");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
