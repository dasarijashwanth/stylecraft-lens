// lib/db/uploaded-source-docs.ts
// CRUD over uploaded_source_docs — versioned, project-scoped externally-
// authored TDS/Spec Sheet/Sales Kit/Other files (see lib/tds-doc-extract.ts,
// lib/gtm-uploaded-tds.ts). Same "new row per upload, old ones kept, one
// active per scope" precedent as lib/db/brand-voice-guides.ts, scoped here
// to (projectId, docType) instead of (brand) — a replacement AUTO-ACTIVATES
// immediately (unlike brand-voice-guides' explicit admin Activate step),
// matching "replacing a TDS versions it" from the feature spec.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockUploadedSourceDoc } from "@/lib/memoryDb";

const STORAGE_BUCKET = "project-source-docs";

export type SourceDocType = "tds" | "spec_sheet" | "sales_kit" | "other";

export interface UploadedSourceDocRow {
  id: string;
  project_id: string;
  doc_type: SourceDocType;
  file_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  version: number;
  is_active: boolean;
  full_text: string | null;
  extraction_status: "pending" | "complete" | "failed";
  // Tracks the SEPARATE structured-facts-derivation step (lib/tds-doc-
  // facts.ts's extractStructuredFacts), distinct from extraction_status
  // above (content extraction). "not_attempted" is the default/pre-this-
  // column value — deliberately distinct from "failed" so old rows don't
  // retroactively show an error they never had.
  facts_extraction_status: "not_attempted" | "complete" | "failed";
  uploaded_by: string | null;
  uploaded_at: string;
  updated_at: string;
}

function mockToRow(d: MockUploadedSourceDoc): UploadedSourceDocRow {
  return {
    id: d.id,
    project_id: d.projectId,
    doc_type: d.docType as SourceDocType,
    file_path: d.id, // memoryDb has no real Storage path — the row id doubles as the lookup key
    file_name: d.fileName,
    file_size_bytes: d.fileSizeBytes,
    mime_type: d.mimeType,
    version: d.version,
    is_active: d.isActive,
    full_text: d.fullText,
    extraction_status: d.extractionStatus as "pending" | "complete" | "failed",
    facts_extraction_status: (d.factsExtractionStatus ?? "not_attempted") as "not_attempted" | "complete" | "failed",
    uploaded_by: d.uploadedBy,
    uploaded_at: d.uploadedAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

export async function listVersionsForProjectDocType(projectId: string, docType: SourceDocType): Promise<UploadedSourceDocRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("uploaded_source_docs")
      .select("*")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .order("version", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return memoryDb.uploadedSourceDocs
    .filter(d => d.projectId === projectId && d.docType === docType)
    .sort((a, b) => b.version - a.version)
    .map(mockToRow);
}

// Every active doc (any type) for a project — what the fill ladder reads.
export async function listActiveDocsForProject(projectId: string): Promise<UploadedSourceDocRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("uploaded_source_docs")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_active", true);
    if (error) throw error;
    return data || [];
  }
  return memoryDb.uploadedSourceDocs
    .filter(d => d.projectId === projectId && d.isActive)
    .map(mockToRow);
}

export async function getSourceDocById(id: string): Promise<UploadedSourceDocRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("uploaded_source_docs").select("*").eq("id", id).maybeSingle();
    return data;
  }
  const row = memoryDb.uploadedSourceDocs.find(d => d.id === id);
  return row ? mockToRow(row) : null;
}

// Creates a new version for (projectId, docType) and immediately activates
// it, deactivating whatever was previously active for that same scope —
// "replacing a TDS versions it, old kept" from the feature spec. Returns
// the new row; caller persists extraction (full_text/status) via
// updateExtractionResult right after, once parsing completes.
export async function createNewVersion(input: {
  projectId: string;
  docType: SourceDocType;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedBy?: string | null;
}): Promise<UploadedSourceDocRow> {
  if (isSupabaseConfigured) {
    const { data: existing } = await supabaseAdmin
      .from("uploaded_source_docs")
      .select("version")
      .eq("project_id", input.projectId)
      .eq("doc_type", input.docType)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (existing?.version ?? 0) + 1;

    const { error: clearError } = await supabaseAdmin
      .from("uploaded_source_docs")
      .update({ is_active: false })
      .eq("project_id", input.projectId)
      .eq("doc_type", input.docType)
      .eq("is_active", true);
    if (clearError) throw clearError;

    const { data, error } = await supabaseAdmin
      .from("uploaded_source_docs")
      .insert({
        project_id: input.projectId,
        doc_type: input.docType,
        file_path: input.filePath,
        file_name: input.fileName,
        file_size_bytes: input.fileSizeBytes,
        mime_type: input.mimeType,
        version: nextVersion,
        is_active: true,
        extraction_status: "pending",
        facts_extraction_status: "not_attempted",
        uploaded_by: input.uploadedBy ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const nextVersion = memoryDb.uploadedSourceDocs
    .filter(d => d.projectId === input.projectId && d.docType === input.docType)
    .reduce((max, d) => Math.max(max, d.version), 0) + 1;

  for (const d of memoryDb.uploadedSourceDocs) {
    if (d.projectId === input.projectId && d.docType === input.docType) d.isActive = false;
  }

  const row: MockUploadedSourceDoc = {
    id: `srcdoc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    projectId: input.projectId,
    docType: input.docType,
    fileBase64: "",
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    mimeType: input.mimeType,
    version: nextVersion,
    isActive: true,
    fullText: null,
    extractionStatus: "pending",
    factsExtractionStatus: "not_attempted",
    uploadedBy: input.uploadedBy ?? null,
    uploadedAt: now,
    updatedAt: now,
  };
  memoryDb.uploadedSourceDocs.push(row);
  return mockToRow(row);
}

// Persists the file bytes for the memoryDb fallback path (no real Storage
// there) — a no-op for Supabase, where the caller already uploaded the
// bytes to Storage directly (signed-URL flow) before this row existed.
export async function setLocalFileBytes(id: string, buffer: Buffer): Promise<void> {
  if (isSupabaseConfigured) return;
  const row = memoryDb.uploadedSourceDocs.find(d => d.id === id);
  if (row) row.fileBase64 = buffer.toString("base64");
}

export async function updateExtractionResult(id: string, fullText: string, status: "complete" | "failed"): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("uploaded_source_docs")
      .update({ full_text: fullText, extraction_status: status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.uploadedSourceDocs.find(d => d.id === id);
  if (row) {
    row.fullText = fullText;
    row.extractionStatus = status;
    row.updatedAt = new Date();
  }
}

export async function updateFactsExtractionStatus(id: string, status: "complete" | "failed"): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin
      .from("uploaded_source_docs")
      .update({ facts_extraction_status: status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.uploadedSourceDocs.find(d => d.id === id);
  if (row) {
    row.factsExtractionStatus = status;
    row.updatedAt = new Date();
  }
}

// "Remove" for this append-only-versioned model means deactivating the
// currently-active version — the slot goes back to "not uploaded" (no
// active row for that project+docType) without deleting history, same
// non-destructive spirit as replacing (createNewVersion) never deleting
// the prior version either.
export async function deactivateVersion(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("uploaded_source_docs").update({ is_active: false }).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.uploadedSourceDocs.find(d => d.id === id);
  if (row) row.isActive = false;
}

export async function getSourceDocFileBuffer(doc: UploadedSourceDocRow): Promise<Buffer> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(doc.file_path);
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer());
  }
  const row = memoryDb.uploadedSourceDocs.find(d => d.id === doc.id);
  if (!row) throw new Error(`Source doc ${doc.id} not found in memoryDb`);
  return Buffer.from(row.fileBase64, "base64");
}
