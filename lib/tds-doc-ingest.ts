// lib/tds-doc-ingest.ts
// Uploaded TDS Ingestion — shared processing pipeline used by both upload
// paths (the signed-URL finalize route, and the direct-multipart route
// used only in local dev without Supabase configured): validate magic
// bytes, extract content, extract structured facts, persist the versioned
// doc + facts, carry forward any previously user-confirmed corrections so
// a replacement upload never silently drops a human's override.
import { detectDocType } from "./file-magic-bytes";
import { extractSourceDocContent, SourceDocFormat } from "./tds-doc-extract";
import { extractStructuredFacts } from "./tds-doc-facts";
import {
  createNewVersion,
  updateExtractionResult,
  setLocalFileBytes,
  listVersionsForProjectDocType,
  SourceDocType,
  UploadedSourceDocRow,
} from "./db/uploaded-source-docs";
import { upsertFacts, carryForwardConfirmedFacts, listFactsForDoc } from "./db/extracted-facts";
import { isSupabaseConfigured } from "./supabase";

export const MAX_SOURCE_DOC_SIZE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_SOURCE_DOC_TYPES: SourceDocType[] = ["tds", "spec_sheet", "sales_kit", "other"];

// The finalize route this feeds has `export const maxDuration = 60` (Vercel
// Hobby's hard cap) — a scanned/image-based PDF's OCR vision fallback alone
// can take up to ~57s worst-case (a 45s first attempt + a 10s retry, see
// lib/openai.ts's createResponseWithRetry), and extractStructuredFacts adds
// its own up-to-30s AI call on top of that. Confirmed live: this combination
// exceeded the platform's hard timeout, which returns a plain HTML error
// page instead of JSON — the browser's `res.json()` then crashes with
// "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" instead of a
// legible error, for EVERY upload that happened to need OCR. Bounding both
// AI-heavy steps to a shared wall-clock budget (same withDeadline/Promise.race
// idiom already used in lib/analysisEngine.ts and lib/indie-brand-lineup.ts)
// guarantees this function always returns within Vercel's window — a slow
// extraction degrades to "extraction failed"/zero facts (the document is
// still saved and viewable) instead of the whole request dying mid-flight.
export const INGEST_DEADLINE_MS = 42_000;

// Exported for direct verification (scripts/verify-tds-doc-ingestion.ts) —
// the real AI providers aren't reachable offline, so there's no way to make
// extractSourceDocContent itself actually run long in a test environment;
// testing this mechanism directly is the only way to cover the fix.
export async function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timeout = new Promise<T>(resolve => setTimeout(() => resolve(fallback), Math.max(0, ms)));
  return Promise.race([promise, timeout]);
}

function inferFormatFromFileName(fileName: string): SourceDocFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

export interface IngestSourceDocInput {
  projectId: string;
  docType: SourceDocType;
  filePath: string; // real Storage path (signed flow) — a placeholder is fine for the memoryDb-only direct flow
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  productName: string;
  uploadedBy?: string | null;
}

export interface IngestSourceDocResult {
  document: UploadedSourceDocRow;
  factsFound: number;
  sampleFacts: { field_id: string; value: string; source_location: string | null }[];
  carriedForwardCount: number;
}

// Validates + processes an already-uploaded/received file buffer. Throws
// an Error with a `.status` (400) for a validation failure — callers
// surface `err.message`/`err.status` directly, same convention as every
// other upload route in this codebase.
export async function ingestSourceDocUpload(input: IngestSourceDocInput): Promise<IngestSourceDocResult> {
  if (input.buffer.length > MAX_SOURCE_DOC_SIZE_BYTES) {
    throw Object.assign(new Error(`File too large (max ${MAX_SOURCE_DOC_SIZE_BYTES / 1024 / 1024}MB)`), { status: 400 });
  }

  const expectedFormat = inferFormatFromFileName(input.fileName);
  if (!expectedFormat) {
    throw Object.assign(new Error("File must be a .pdf, .xlsx/.xlsm, or .docx"), { status: 400 });
  }
  const detected = detectDocType(input.buffer);
  if (detected === null || detected !== expectedFormat) {
    // Diagnostic only (never blocks/changes the rejection) — this exact
    // check has already needed widening once in production (the PDF sniff
    // window was too small for a real, unmodified file); logging the
    // leading bytes means a future edge case is debuggable from server
    // logs instead of requiring the file itself to be reproduced.
    console.warn(
      `[tds-doc-ingest] rejected "${input.fileName}" — expected ${expectedFormat}, detected ${detected ?? "null"}. First 32 bytes (hex): ${input.buffer.subarray(0, 32).toString("hex")}`
    );
    throw Object.assign(new Error("File content doesn't match its extension — a real PDF/XLSX/DOCX is required"), { status: 400 });
  }

  // The doc CURRENTLY active for this project+docType (before this upload
  // creates its own new version) — its confirmed facts carry forward.
  const priorVersions = await listVersionsForProjectDocType(input.projectId, input.docType);
  const priorActive = priorVersions.find(d => d.is_active) || null;

  const document = await createNewVersion({
    projectId: input.projectId,
    docType: input.docType,
    filePath: input.filePath,
    fileName: input.fileName,
    fileSizeBytes: input.buffer.length,
    mimeType: input.mimeType,
    uploadedBy: input.uploadedBy,
  });
  if (!isSupabaseConfigured) {
    await setLocalFileBytes(document.id, input.buffer);
  }

  const ingestStartTime = Date.now();
  const content = await withDeadline(
    extractSourceDocContent(input.buffer, expectedFormat),
    INGEST_DEADLINE_MS,
    { fullText: "", locations: [], extractionStatus: "failed" as const, extractionMethod: "failed" as const }
  );
  await updateExtractionResult(document.id, content.fullText, content.extractionStatus);

  let factsFound = 0;
  let sampleFacts: { field_id: string; value: string; source_location: string | null }[] = [];
  const factsBudgetLeft = INGEST_DEADLINE_MS - (Date.now() - ingestStartTime);
  if (content.extractionStatus === "complete" && factsBudgetLeft > 0) {
    const candidates = await withDeadline(extractStructuredFacts(content, input.productName), factsBudgetLeft, []);
    if (candidates.length > 0) {
      await upsertFacts(
        document.id,
        input.projectId,
        candidates.map(c => ({ field_id: c.field_id, value: c.value, raw_text: c.raw_text, source_location: c.source_location }))
      );
    }
    factsFound = candidates.length;
    sampleFacts = candidates.slice(0, 5).map(c => ({ field_id: c.field_id, value: c.value, source_location: c.source_location ?? null }));
  }

  let carriedForwardCount = 0;
  if (priorActive) {
    const priorFacts = await listFactsForDoc(priorActive.id);
    carriedForwardCount = priorFacts.filter(f => f.confirmed_by_user).length;
    if (carriedForwardCount > 0) {
      await carryForwardConfirmedFacts(priorActive.id, document.id, input.projectId);
    }
  }

  return { document, factsFound, sampleFacts, carriedForwardCount };
}
