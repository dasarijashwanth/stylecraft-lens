// lib/file-magic-bytes.ts
// Real content-type verification by file signature ("magic bytes"), not by
// trusting a client-supplied extension or Content-Type/contentType field —
// either of those can be spoofed trivially (rename malicious.html to
// photo.png, declare Content-Type: image/png). Used wherever this app
// accepts an image upload (project artwork, Contact Support screenshots).
export type DetectedImageType = "png" | "jpeg" | "webp" | null;

export function detectImageType(buffer: Buffer): DetectedImageType {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function isAllowedImage(buffer: Buffer, allowed: DetectedImageType[] = ["png", "jpeg"]): boolean {
  const detected = detectImageType(buffer);
  return detected !== null && allowed.includes(detected);
}

// Uploaded TDS Ingestion — validates an uploaded document's REAL bytes, not
// its client-declared extension/Content-Type, same reasoning as
// detectImageType above (a renamed malicious.html could otherwise pass as
// any of these). PDF has its own unambiguous signature; XLSX/DOCX are both
// OOXML (a ZIP with the same "PK\x03\x04" signature as a plain zip, a
// .pptx, or a cross-mislabeled OOXML file) — disambiguated by checking for
// each format's own defining internal part path.
export type DetectedDocType = "pdf" | "xlsx" | "docx" | null;

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

function zipContainsPath(buffer: Buffer, path: string): boolean {
  // A cheap, dependency-free containment check — good enough to
  // disambiguate xlsx/docx/pptx/plain-zip without a full zip parse; the
  // real parse (PizZip/xlsx) still runs at extraction time and would
  // itself reject a genuinely malformed file.
  return buffer.includes(Buffer.from(path, "ascii"));
}

export function detectDocType(buffer: Buffer): DetectedDocType {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "pdf";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) {
    if (zipContainsPath(buffer, "xl/workbook.xml")) return "xlsx";
    if (zipContainsPath(buffer, "word/document.xml")) return "docx";
  }
  return null;
}

export function isAllowedDocType(buffer: Buffer, allowed: Exclude<DetectedDocType, null>[]): boolean {
  const detected = detectDocType(buffer);
  return detected !== null && allowed.includes(detected);
}
