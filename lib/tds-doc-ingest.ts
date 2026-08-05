// lib/tds-doc-ingest.ts
// Uploaded TDS Ingestion — shared processing pipeline used by both upload
// paths (the signed-URL finalize route, and the direct-multipart route
// used only in local dev without Supabase configured): validate magic
// bytes, extract content, persist the versioned doc, carry forward any
// previously user-confirmed corrections so a replacement upload never
// silently drops a human's override. Structured fact extraction
// (extractStructuredFacts) is DELIBERATELY a separate function
// (deriveFactsForDoc, below) called from its OWN route/request — see that
// function's own header comment for why.
import { detectDocType, looksLikeText } from "./file-magic-bytes";
import { extractSourceDocContent, SourceDocFormat, ExtractedDocContent } from "./tds-doc-extract";
import { extractStructuredFacts } from "./tds-doc-facts";
import {
  createNewVersion,
  updateExtractionResult,
  setLocalFileBytes,
  listVersionsForProjectDocType,
  getSourceDocById,
  SourceDocType,
  UploadedSourceDocRow,
} from "./db/uploaded-source-docs";
import { upsertFacts, carryForwardConfirmedFacts, listFactsForDoc } from "./db/extracted-facts";
import { isSupabaseConfigured } from "./supabase";

// Matches the feature spec's own 15MB ceiling exactly (previously 20MB —
// tightened, not loosened, so a file the spec calls "too large" at 15.1MB
// is genuinely rejected server-side too, not just by a client-side check
// that a forged/direct request could bypass).
export const MAX_SOURCE_DOC_SIZE_BYTES = 15 * 1024 * 1024;
export const ALLOWED_SOURCE_DOC_TYPES: SourceDocType[] = ["tds", "spec_sheet", "sales_kit", "other"];

// Both the finalize route and the facts-derivation route this feeds have
// `export const maxDuration = 60` (Vercel Hobby's hard cap). A scanned/
// image-based PDF's OCR vision fallback alone can take up to ~57s
// worst-case (a 45s first attempt + a 10s retry, see lib/openai.ts's
// createResponseWithRetry) — CONFIRMED LIVE, this happened repeatedly in
// production even after two earlier attempts to share one budget between
// content-extraction AND fact-extraction in a single request: OCR alone can
// already consume nearly the entire 60s window, so ANY further AI work
// (extractStructuredFacts's own up-to-30s call) stacked in the SAME request
// still risked the platform's hard kill — which returns a plain HTML error
// page instead of JSON, and the browser's `res.json()` then crashes with
// "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" / "Server
// took too long to respond" instead of a legible error.
//
// The real fix is architectural, not a tighter shared clock: content
// extraction (ingestSourceDocUpload, this file) and fact extraction
// (deriveFactsForDoc, below) are now two SEPARATE requests, each with its
// own full deadline, so they never compound within one 60s window — the
// same "one phase per request" discipline this codebase already uses for
// the analysis and GTM generation pipelines (lib/analysisEngine.ts,
// lib/project-generation-engine.ts), applied here for the same reason.
export const CONTENT_EXTRACTION_DEADLINE_MS = 50_000;
export const FACTS_DERIVATION_DEADLINE_MS = 50_000;

// Exported for direct verification (scripts/verify-tds-doc-ingestion.ts) —
// the real AI providers aren't reachable offline, so there's no way to make
// extractSourceDocContent itself actually run long in a test environment;
// testing this mechanism directly is the only way to cover the fix.
export async function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timeout = new Promise<T>(resolve => setTimeout(() => resolve(fallback), Math.max(0, ms)));
  return Promise.race([promise, timeout]);
}

export function inferFormatFromFileName(fileName: string): SourceDocFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".doc")) return "doc";
  if (lower.endsWith(".xls")) return "xls";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}

// User-facing label for the accepted-types error message — kept in one
// place so the client (pre-upload check) and server (this file's own
// rejection message) always describe the same set the same way.
export const ACCEPTED_SOURCE_DOC_TYPES_LABEL = "PDF, DOC/DOCX, XLS/XLSX, or CSV";

export interface IngestSourceDocInput {
  projectId: string;
  docType: SourceDocType;
  filePath: string; // real Storage path (signed flow) — a placeholder is fine for the memoryDb-only direct flow
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  productName: string;
  uploadedBy?: string | null;
  // Captured at the very top of the calling route handler, BEFORE the
  // Storage download — lets the shared deadline below account for time
  // already spent on the download/auth/DB lookups that happen before this
  // function is even called, not just this function's own internal work.
  // Defaults to "now" (effectively un-budgeted) only for callers that
  // genuinely have no earlier reference point.
  routeStartTime?: number;
}

export interface IngestSourceDocResult {
  document: UploadedSourceDocRow;
  factsFound: number;
  sampleFacts: { field_id: string; value: string; source_location: string | null }[];
  carriedForwardCount: number;
}

// Validates + processes an already-uploaded/received file buffer: magic
// bytes, content extraction (including OCR for a scanned PDF), saves the
// new document version, carries forward prior user-confirmed facts.
// Deliberately does NOT call extractStructuredFacts — see deriveFactsForDoc
// below and this file's header comment for why that's a separate request.
// Throws an Error with a `.status` (400) for a validation failure — callers
// surface `err.message`/`err.status` directly, same convention as every
// other upload route in this codebase.
export async function ingestSourceDocUpload(input: IngestSourceDocInput): Promise<IngestSourceDocResult> {
  if (input.buffer.length > MAX_SOURCE_DOC_SIZE_BYTES) {
    const actualMb = (input.buffer.length / 1024 / 1024).toFixed(1);
    const maxMb = MAX_SOURCE_DOC_SIZE_BYTES / 1024 / 1024;
    throw Object.assign(new Error(`File is ${actualMb} MB — max is ${maxMb} MB`), { status: 400 });
  }

  const expectedFormat = inferFormatFromFileName(input.fileName);
  if (!expectedFormat) {
    throw Object.assign(new Error(`File type not accepted — upload ${ACCEPTED_SOURCE_DOC_TYPES_LABEL}`), { status: 400 });
  }

  // CSV has no binary signature to match against (it's plain text) —
  // validated by content-sniffing instead of detectDocType, which only
  // ever returns pdf/xlsx/docx/doc/xls. A binary file renamed .csv is
  // still rejected, just via looksLikeText's own control-byte check.
  if (expectedFormat === "csv") {
    if (!looksLikeText(input.buffer)) {
      console.warn(`[tds-doc-ingest] rejected "${input.fileName}" — declared .csv but content contains binary bytes. First 32 bytes (hex): ${input.buffer.subarray(0, 32).toString("hex")}`);
      throw Object.assign(new Error("This file doesn't look like plain-text CSV content — a real CSV export is required"), { status: 400 });
    }
  } else {
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
      throw Object.assign(new Error(`File content doesn't match its extension — a real ${ACCEPTED_SOURCE_DOC_TYPES_LABEL} file is required`), { status: 400 });
    }
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

  const routeStartTime = input.routeStartTime ?? Date.now();
  const extractionBudget = Math.max(0, CONTENT_EXTRACTION_DEADLINE_MS - (Date.now() - routeStartTime));
  const content = await withDeadline(
    extractSourceDocContent(input.buffer, expectedFormat),
    extractionBudget,
    { fullText: "", locations: [], extractionStatus: "failed" as const, extractionMethod: "failed" as const }
  );
  await updateExtractionResult(document.id, content.fullText, content.extractionStatus);

  let carriedForwardCount = 0;
  if (priorActive) {
    const priorFacts = await listFactsForDoc(priorActive.id);
    carriedForwardCount = priorFacts.filter(f => f.confirmed_by_user).length;
    if (carriedForwardCount > 0) {
      await carryForwardConfirmedFacts(priorActive.id, document.id, input.projectId);
    }
  }

  // factsFound/sampleFacts are always 0/[] from THIS call now — the actual
  // facts arrive from the caller's own follow-up call to deriveFactsForDoc
  // (see lib/upload-source-doc-client.ts, which calls both in sequence and
  // merges the result so nothing downstream of the client needed to change).
  return { document, factsFound: 0, sampleFacts: [], carriedForwardCount };
}

export interface DeriveFactsResult {
  factsFound: number;
  sampleFacts: { field_id: string; value: string; source_location: string | null }[];
}

// Structured fact extraction (extractStructuredFacts's own AI call, up to
// ~30s) — split out of ingestSourceDocUpload into its OWN request/route
// (app/api/projects/[id]/source-docs/[docId]/facts's POST handler) so it
// never has to share a single 60s Vercel window with content extraction's
// own OCR vision call (which alone can take up to ~57s worst-case). Reads
// the already-persisted full_text from the document row — no re-download,
// no re-extraction. Best-effort: a failure here never invalidates the
// upload itself (the document + its extracted text are already saved by
// ingestSourceDocUpload); the caller just gets factsFound: 0.
//
// Trade-off accepted for this fix: `locations` (page/sheet attribution for
// each fact) isn't persisted on uploaded_source_docs, so facts derived here
// carry no source_location — a minor quality nuance (no "found on p.3"
// label in the review UI), not a functional regression. Can be restored
// later with a `locations JSONB` column if wanted.
export async function deriveFactsForDoc(documentId: string, projectId: string, productName: string, routeStartTime?: number): Promise<DeriveFactsResult> {
  const doc = await getSourceDocById(documentId);
  if (!doc || doc.extraction_status !== "complete" || !doc.full_text) {
    return { factsFound: 0, sampleFacts: [] };
  }

  const content: ExtractedDocContent = { fullText: doc.full_text, locations: [], extractionStatus: "complete", extractionMethod: "text-layer" };
  const start = routeStartTime ?? Date.now();
  const budget = Math.max(0, FACTS_DERIVATION_DEADLINE_MS - (Date.now() - start));
  if (budget <= 0) return { factsFound: 0, sampleFacts: [] };

  const candidates = await withDeadline(extractStructuredFacts(content, productName), budget, []);
  if (candidates.length > 0) {
    await upsertFacts(
      documentId,
      projectId,
      candidates.map(c => ({ field_id: c.field_id, value: c.value, raw_text: c.raw_text, source_location: c.source_location }))
    );
  }
  return {
    factsFound: candidates.length,
    sampleFacts: candidates.slice(0, 5).map(c => ({ field_id: c.field_id, value: c.value, source_location: c.source_location ?? null })),
  };
}
