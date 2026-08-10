// lib/zip-safety.ts
// Security audit fix — zip-bomb / decompression-bomb guard. Every place
// this codebase parses an uploaded .xlsx/.docx/.pptx with PizZip (or, for
// .xlsx content extraction, the `xlsx` package) fully decompresses the
// archive's entries with no size ceiling — a maliciously crafted small
// file (a DEFLATE bomb, achievable at ~1000:1 ratios on repeated-byte
// content) could decompress to multiple GB in-process and OOM/crash the
// serverless function. Some of these paths are reachable by ANY
// authenticated project member (source-doc uploads), not just admins.
//
// PizZip exposes each entry's compressed/uncompressed size from the zip's
// central directory immediately after construction — BEFORE any entry's
// content is actually decompressed (`.asText()`/`.asUint8Array()` do the
// real decompression, lazily, per-file). That lets this check reject a
// bomb before doing any real decompression work at all.
import PizZip from "pizzip";

// `status = 400` so every call site's existing `err.status || 500` catch
// pattern (the convention across this codebase's API routes) naturally
// reports this as a client error, not a server error.
export class ZipBombError extends Error {
  status = 400;
}

const MAX_ZIP_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 300 * 1024 * 1024; // 300MB
const MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200MB
// A real OOXML part (XML text) rarely compresses much past ~50:1; a ratio
// past this is a strong bomb signal regardless of absolute size.
const MAX_COMPRESSION_RATIO = 300;

// Call with either a Buffer (constructs the zip itself) or an already-open
// PizZip instance (avoids re-parsing when the caller already has one).
export function assertZipSafe(input: Buffer | PizZip): void {
  const zip = input instanceof PizZip ? input : new PizZip(input);
  const entries = Object.values(zip.files) as any[];

  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new ZipBombError(`Archive has too many entries (${entries.length}, max ${MAX_ZIP_ENTRIES})`);
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const data = entry._data;
    const uncompressed: number = data?.uncompressedSize || 0;
    const compressed: number = data?.compressedSize || 0;

    if (uncompressed > MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES) {
      throw new ZipBombError(`Archive entry "${entry.name}" decompresses to ${uncompressed} bytes (max ${MAX_SINGLE_ENTRY_UNCOMPRESSED_BYTES})`);
    }
    if (compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO) {
      throw new ZipBombError(`Archive entry "${entry.name}" has a suspicious compression ratio (${Math.round(uncompressed / compressed)}:1)`);
    }
    totalUncompressed += uncompressed;
  }

  if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new ZipBombError(`Archive decompresses to ${totalUncompressed} bytes total (max ${MAX_TOTAL_UNCOMPRESSED_BYTES})`);
  }
}

// Same check for a buffer that isn't necessarily well-formed as a zip at
// all (e.g. a corrupt upload) — returns a plain boolean instead of
// throwing, for call sites that want to fall through to their own "extraction
// failed" handling rather than a hard error.
export function isZipSafe(buffer: Buffer): boolean {
  try {
    assertZipSafe(buffer);
    return true;
  } catch {
    return false;
  }
}
