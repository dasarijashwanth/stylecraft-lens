// lib/db/project-decks.ts
// CRUD over project_decks — append-only version history (mirrors
// lib/db/snapshots.ts's "never overwrite, insert a new row" pattern), same
// Supabase+memoryDb dual-path style as lib/db/deck-templates.ts. Binary
// output lives in Storage bucket "project-decks" with a base64-on-the-row
// fallback for local dev — no public URL, bytes only ever served through
// the authenticated /api/projects/:id/deck/download route (Phase 4).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockProjectDeck } from "@/lib/memoryDb";
import type { DocumentRow, DocumentFieldRow } from "@/lib/db/documents";
import type { ProjectDeckStatus } from "@/lib/deck-types";

const STORAGE_BUCKET = "project-decks";
const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface ProjectDeckRow {
  id: string;
  project_id: string;
  template_id: string | null;
  status: ProjectDeckStatus;
  file_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  placeholder_values: Record<string, any>;
  slides_removed: number[];
  error_message: string | null;
  gtm_snapshot_at: string | null;
  generated_at: string | null;
  drive_url: string | null;
  drive_file_id: string | null;
  created_at: string;
}

function mockToRow(row: MockProjectDeck): ProjectDeckRow {
  return {
    id: row.id,
    project_id: row.projectId,
    template_id: row.templateId,
    status: row.status as ProjectDeckStatus,
    file_path: row.fileBase64 ? row.id : null, // memoryDb has no real Storage path — the row id doubles as the lookup key
    file_name: row.fileName,
    file_size_bytes: row.fileSizeBytes,
    placeholder_values: row.placeholderValues ?? {},
    slides_removed: row.slidesRemoved ?? [],
    error_message: row.errorMessage,
    gtm_snapshot_at: row.gtmSnapshotAt,
    generated_at: row.generatedAt ? row.generatedAt.toISOString() : null,
    drive_url: row.driveUrl,
    drive_file_id: row.driveFileId,
    created_at: row.createdAt.toISOString(),
  };
}

// Creates the "pending" row that a generation run then fills in via
// markDeckGenerating/markDeckComplete/markDeckFailed — matches the
// project_generation_state precedent of a row existing before its work starts,
// so a client polling mid-generation always has something to show.
export async function createPendingProjectDeck(input: {
  projectId: string;
  templateId: string | null;
}): Promise<ProjectDeckRow> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("project_decks")
      .insert({ project_id: input.projectId, template_id: input.templateId, status: "pending" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const row: MockProjectDeck = {
    id: `deck_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    projectId: input.projectId,
    templateId: input.templateId,
    status: "pending",
    fileBase64: null,
    fileName: null,
    fileSizeBytes: null,
    placeholderValues: {},
    slidesRemoved: [],
    errorMessage: null,
    gtmSnapshotAt: null,
    generatedAt: null,
    driveUrl: null,
    driveFileId: null,
    createdAt: now,
  };
  memoryDb.projectDecks.push(row);
  return mockToRow(row);
}

export async function markDeckGenerating(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("project_decks").update({ status: "generating" }).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.projectDecks.find(d => d.id === id);
  if (row) row.status = "generating";
}

export async function markDeckComplete(id: string, result: {
  fileBuffer: Buffer;
  fileName: string;
  placeholderValues: Record<string, any>;
  slidesRemoved: number[];
  gtmSnapshotAt: string | null;
}): Promise<ProjectDeckRow> {
  if (isSupabaseConfigured) {
    const filePath = `${id}-${result.fileName.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, result.fileBuffer, { contentType: PPTX_MIME_TYPE, upsert: true });
    if (uploadError) throw uploadError;

    const { data, error } = await supabaseAdmin
      .from("project_decks")
      .update({
        status: "complete",
        file_path: filePath,
        file_name: result.fileName,
        file_size_bytes: result.fileBuffer.length,
        placeholder_values: result.placeholderValues,
        slides_removed: result.slidesRemoved,
        gtm_snapshot_at: result.gtmSnapshotAt,
        generated_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.projectDecks.find(d => d.id === id);
  if (!row) throw new Error(`project_decks row ${id} not found in memoryDb`);
  row.status = "complete";
  row.fileBase64 = result.fileBuffer.toString("base64");
  row.fileName = result.fileName;
  row.fileSizeBytes = result.fileBuffer.length;
  row.placeholderValues = result.placeholderValues;
  row.slidesRemoved = result.slidesRemoved;
  row.gtmSnapshotAt = result.gtmSnapshotAt;
  row.generatedAt = new Date();
  row.errorMessage = null;
  return mockToRow(row);
}

export async function markDeckFailed(id: string, errorMessage: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("project_decks").update({ status: "failed", error_message: errorMessage }).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.projectDecks.find(d => d.id === id);
  if (row) {
    row.status = "failed";
    row.errorMessage = errorMessage;
  }
}

export async function listProjectDecks(projectId: string): Promise<ProjectDeckRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("project_decks")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  return memoryDb.projectDecks
    .filter(d => d.projectId === projectId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(mockToRow);
}

export async function getLatestProjectDeck(projectId: string): Promise<ProjectDeckRow | null> {
  const rows = await listProjectDecks(projectId);
  return rows[0] ?? null;
}

export async function getProjectDeckById(id: string): Promise<ProjectDeckRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("project_decks").select("*").eq("id", id).maybeSingle();
    return data;
  }
  const row = memoryDb.projectDecks.find(d => d.id === id);
  return row ? mockToRow(row) : null;
}

export async function getProjectDeckFileBuffer(deck: ProjectDeckRow): Promise<Buffer> {
  if (isSupabaseConfigured) {
    if (!deck.file_path) throw new Error(`Deck ${deck.id} has no file_path`);
    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(deck.file_path);
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer());
  }

  const row = memoryDb.projectDecks.find(d => d.id === deck.id);
  if (!row || !row.fileBase64) throw new Error(`Deck ${deck.id} has no file content in memoryDb`);
  return Buffer.from(row.fileBase64, "base64");
}

export async function setDeckDriveInfo(id: string, driveUrl: string, driveFileId: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("project_decks").update({ drive_url: driveUrl, drive_file_id: driveFileId }).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = memoryDb.projectDecks.find(d => d.id === id);
  if (row) {
    row.driveUrl = driveUrl;
    row.driveFileId = driveFileId;
  }
}

// GTM's true last-edited moment — the parent `documents` row's updated_at
// alone is insufficient, since a manual single-field edit
// (updateDocumentField) only bumps the child document_fields row, not the
// parent. Takes the max of both so staleness detection (Phase 4) can't miss
// a field-level edit that never touched the parent row.
export function getGtmLastEditedAt(document: DocumentRow, fields: DocumentFieldRow[]): string {
  let latest = document.updated_at;
  for (const f of fields) {
    if (f.updated_at > latest) latest = f.updated_at;
  }
  return latest;
}
