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
// each format's own defining internal part path. Legacy DOC/XLS (pre-2007
// binary Office formats) both use the same CFB/OLE2 container signature —
// disambiguated by scanning for each format's own defining stream name
// (CFB directory entries store stream names as UTF-16LE, so the ASCII
// bytes of "WordDocument"/"Workbook" never appear literally — encode as
// UTF-16LE before scanning, same "cheap, dependency-free containment
// check" philosophy as zipContainsPath below). CSV has no binary
// signature at all (it's plain text) — validated separately by
// looksLikeText, never through this function.
export type DetectedDocType = "pdf" | "xlsx" | "docx" | "doc" | "xls" | null;

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .doc/.xls container

function zipContainsPath(buffer: Buffer, path: string): boolean {
  // A cheap, dependency-free containment check — good enough to
  // disambiguate xlsx/docx/pptx/plain-zip without a full zip parse; the
  // real parse (PizZip/xlsx) still runs at extraction time and would
  // itself reject a genuinely malformed file.
  return buffer.includes(Buffer.from(path, "ascii"));
}

function cfbContainsStreamName(buffer: Buffer, name: string): boolean {
  return buffer.includes(Buffer.from(name, "utf16le"));
}

// Real-world PDFs frequently have leading bytes before "%PDF-" (a UTF-8
// BOM, or junk prepended by a scanner/third-party re-save tool) even though
// byte 0 is what the spec recommends — every real PDF reader (pdfjs,
// poppler, Acrobat itself) tolerates this. A 1KB sniff window (this file's
// first fix for this exact class of bug) still rejected real, unmodified
// PDFs in production — some scan-to-PDF/print-driver tools prepend an
// embedded thumbnail preview or a large XMP metadata packet that can run
// well past 1KB before the actual header. Widened to 64KB (a `buffer.
// includes()` scan over that is still effectively free, and a tiny
// fraction of MAX_SOURCE_DOC_SIZE_BYTES's 20MB cap) rather than guessing
// at another still-too-small fixed number.
const PDF_SNIFF_WINDOW_BYTES = 65536;
const PDF_MARKER = Buffer.from("%PDF-", "ascii");

export function detectDocType(buffer: Buffer): DetectedDocType {
  if (buffer.subarray(0, PDF_SNIFF_WINDOW_BYTES).includes(PDF_MARKER)) {
    return "pdf";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) {
    if (zipContainsPath(buffer, "xl/workbook.xml")) return "xlsx";
    if (zipContainsPath(buffer, "word/document.xml")) return "docx";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(CFB_SIGNATURE)) {
    if (cfbContainsStreamName(buffer, "WordDocument")) return "doc";
    if (cfbContainsStreamName(buffer, "Workbook") || cfbContainsStreamName(buffer, "Book")) return "xls";
  }
  return null;
}

export function isAllowedDocType(buffer: Buffer, allowed: Exclude<DetectedDocType, null>[]): boolean {
  const detected = detectDocType(buffer);
  return detected !== null && allowed.includes(detected);
}

// CSV has no binary signature — a real CSV is plain text (any encoding a
// spreadsheet app would emit: UTF-8, UTF-8 w/ BOM, or Latin-1/Windows-1252
// for older exports). Rejects a binary file renamed .csv by checking for
// NUL bytes and a high proportion of non-printable control characters in a
// leading sample — the same "sniff a bounded window, don't fully parse"
// discipline as detectDocType's own PDF check.
const TEXT_SNIFF_WINDOW_BYTES = 65536;
const MAX_NON_TEXT_BYTE_RATIO = 0.02;

export function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, TEXT_SNIFF_WINDOW_BYTES);
  if (sample.length === 0) return false;
  if (sample.includes(0x00)) return false; // a NUL byte never appears in real text content

  let nonTextBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    // Printable ASCII, common whitespace (tab/LF/CR), or any byte >= 0x80
    // (a real UTF-8 multi-byte sequence or a Latin-1/Windows-1252
    // character) is allowed — only the C0 control-character range minus
    // whitespace is treated as "binary noise."
    const isPrintableOrWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d || byte >= 0x20;
    if (!isPrintableOrWhitespace) nonTextBytes++;
  }
  return nonTextBytes / sample.length <= MAX_NON_TEXT_BYTE_RATIO;
}
