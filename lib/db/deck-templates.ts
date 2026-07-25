// lib/db/deck-templates.ts
// CRUD over deck_templates — same Supabase+memoryDb dual-path style as
// lib/db/snapshots.ts/lib/db/documents.ts. The binary .pptx lives in the
// Supabase Storage bucket "deck-templates" (mirroring project_artwork's
// upload pattern in app/api/projects/[id]/artwork/route.ts) with a
// base64-on-the-row fallback for local dev without Supabase configured —
// there is no public URL for either path (see supabase_schema.sql's
// deck_templates comment), bytes are only ever served through the
// authenticated admin routes.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockDeckTemplate } from "@/lib/memoryDb";
import { DeckPlaceholderMap, emptyPlaceholderMap } from "@/lib/deck-types";

const STORAGE_BUCKET = "deck-templates";
const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface DeckTemplateRow {
  id: string;
  name: string;
  file_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  slide_count: number;
  placeholder_map: DeckPlaceholderMap;
  is_active: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
  updated_at: string;
}

function mockToRow(row: MockDeckTemplate): DeckTemplateRow {
  return {
    id: row.id,
    name: row.name,
    file_path: row.id, // memoryDb has no real Storage path — the row id doubles as the lookup key
    file_name: row.fileName,
    file_size_bytes: row.fileSizeBytes,
    slide_count: row.slideCount,
    placeholder_map: row.placeholderMap ?? emptyPlaceholderMap(),
    is_active: row.isActive,
    uploaded_by: row.uploadedBy,
    uploaded_at: row.uploadedAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function createDeckTemplate(input: {
  name: string;
  fileBuffer: Buffer;
  fileName: string;
  slideCount: number;
  placeholderMap: DeckPlaceholderMap;
  uploadedBy?: string | null;
}): Promise<DeckTemplateRow> {
  const filePath = `${Date.now()}-${input.fileName.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

  if (isSupabaseConfigured) {
    try {
      const { error: uploadError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, input.fileBuffer, { contentType: PPTX_MIME_TYPE, upsert: true });
      if (uploadError) throw uploadError;

      const { data, error } = await supabaseAdmin
        .from("deck_templates")
        .insert({
          name: input.name,
          file_path: filePath,
          file_name: input.fileName,
          file_size_bytes: input.fileBuffer.length,
          slide_count: input.slideCount,
          placeholder_map: input.placeholderMap,
          is_active: false,
          uploaded_by: input.uploadedBy ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn("Supabase deck template create failed, falling back to memoryDb:", e);
    }
  }

  const now = new Date();
  const row: MockDeckTemplate = {
    id: `decktpl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    name: input.name,
    fileBase64: input.fileBuffer.toString("base64"),
    fileName: input.fileName,
    fileSizeBytes: input.fileBuffer.length,
    slideCount: input.slideCount,
    placeholderMap: input.placeholderMap,
    isActive: false,
    uploadedBy: input.uploadedBy ?? null,
    uploadedAt: now,
    updatedAt: now,
  };
  memoryDb.deckTemplates.push(row);
  return mockToRow(row);
}

// Registers a template whose bytes are ALREADY in Storage — used by the
// signed-upload-URL flow (app/api/admin/deck-templates/upload-url +
// .../finalize), where the browser uploads directly to Storage to bypass
// Vercel's serverless function request-body limit (~4.5MB), which a real
// branded .pptx routinely exceeds. Supabase-only: that flow only exists
// when Storage is actually configured (see the finalize route's own
// isSupabaseConfigured check before calling this).
export async function createDeckTemplateFromStoragePath(input: {
  name: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  slideCount: number;
  placeholderMap: DeckPlaceholderMap;
  uploadedBy?: string | null;
}): Promise<DeckTemplateRow> {
  const { data, error } = await supabaseAdmin
    .from("deck_templates")
    .insert({
      name: input.name,
      file_path: input.filePath,
      file_name: input.fileName,
      file_size_bytes: input.fileSizeBytes,
      slide_count: input.slideCount,
      placeholder_map: input.placeholderMap,
      is_active: false,
      uploaded_by: input.uploadedBy ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listDeckTemplates(): Promise<DeckTemplateRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("deck_templates")
      .select("*")
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  return [...memoryDb.deckTemplates]
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .map(mockToRow);
}

export async function getDeckTemplateById(id: string): Promise<DeckTemplateRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("deck_templates").select("*").eq("id", id).maybeSingle();
    return data;
  }

  const row = memoryDb.deckTemplates.find(t => t.id === id);
  return row ? mockToRow(row) : null;
}

export async function getActiveDeckTemplate(): Promise<DeckTemplateRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("deck_templates").select("*").eq("is_active", true).maybeSingle();
    return data;
  }

  const row = memoryDb.deckTemplates.find(t => t.isActive);
  return row ? mockToRow(row) : null;
}

// Clears is_active on every other row, then sets it on `id` — two sequential
// statements (no multi-statement transaction via supabase-js), same
// low-concurrency-tolerant style already used elsewhere in this app (e.g.
// setActiveDeckTemplate is an admin-only, rare action, not a hot path).
export async function setActiveDeckTemplate(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error: clearError } = await supabaseAdmin.from("deck_templates").update({ is_active: false }).eq("is_active", true);
    if (clearError) throw clearError;
    const { error: setError } = await supabaseAdmin.from("deck_templates").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", id);
    if (setError) throw setError;
    return;
  }

  for (const t of memoryDb.deckTemplates) t.isActive = false;
  const row = memoryDb.deckTemplates.find(t => t.id === id);
  if (row) {
    row.isActive = true;
    row.updatedAt = new Date();
  }
}

export async function updateDeckTemplatePlaceholderMap(id: string, map: DeckPlaceholderMap): Promise<DeckTemplateRow | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("deck_templates")
      .update({ placeholder_map: map, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.deckTemplates.find(t => t.id === id);
  if (!row) return null;
  row.placeholderMap = map;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function getDeckTemplateFileBuffer(template: DeckTemplateRow): Promise<Buffer> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(template.file_path);
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer());
  }

  const row = memoryDb.deckTemplates.find(t => t.id === template.id);
  if (!row) throw new Error(`Deck template ${template.id} not found in memoryDb`);
  return Buffer.from(row.fileBase64, "base64");
}
