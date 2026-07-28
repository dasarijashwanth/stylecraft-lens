// scripts/verify-file-magic-bytes.ts
// Offline verification of lib/file-magic-bytes.ts — real content-type
// detection by file signature, used by project artwork upload
// (app/api/projects/[id]/artwork) and the Contact Support screenshot flow
// (app/api/support/contact) to reject a file whose actual bytes don't
// match an accepted image format, regardless of what its extension or
// client-declared Content-Type/contentType field claims.
//
// Run with: npx tsx scripts/verify-file-magic-bytes.ts
import { detectImageType, isAllowedImage } from "../lib/file-magic-bytes";

let passed = 0;
let failed = 0;

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`✗ FAILED: ${label} — expected ${expected}, got ${actual}`);
  }
}

// Real signatures
assertEqual(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])), "png", "real PNG signature");
assertEqual(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), "jpeg", "real JPEG signature");
assertEqual(
  detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")])),
  "webp",
  "real WEBP signature"
);

// The exact "renamed .html as .png" attack the spec's manual test
// checklist calls out — no magic bytes match, regardless of what the
// upload's filename/Content-Type/contentType field claimed.
const fakeHtml = Buffer.from("<html><body><script>alert(document.cookie)</script></body></html>");
assertEqual(detectImageType(fakeHtml), null, "HTML content renamed to look like an image is rejected");

// SVG is deliberately never in the accepted set — no binary signature
// matches it (it's XML text), so it's rejected the same way as any other
// non-raster content, consistent with dropping SVG support entirely.
const svg = Buffer.from('<svg onload="alert(1)"></svg>');
assertEqual(detectImageType(svg), null, "SVG (XSS-capable) has no matching binary signature");

// isAllowedImage respects an explicit allow-list
assertEqual(isAllowedImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ["png"]), true, "PNG allowed when in the allow-list");
assertEqual(isAllowedImage(Buffer.from([0xff, 0xd8, 0xff]), ["png"]), false, "JPEG rejected when only PNG is allowed");
assertEqual(isAllowedImage(fakeHtml, ["png", "jpeg"]), false, "fake HTML rejected regardless of allow-list");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
