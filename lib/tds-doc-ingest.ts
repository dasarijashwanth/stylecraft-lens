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

  const content = await extractSourceDocContent(input.buffer, expectedFormat);
  await updateExtractionResult(document.id, content.fullText, content.extractionStatus);

  let factsFound = 0;
  let sampleFacts: { field_id: string; value: string; source_location: string | null }[] = [];
  if (content.extractionStatus === "complete") {
    const candidates = await extractStructuredFacts(content, input.productName);
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
