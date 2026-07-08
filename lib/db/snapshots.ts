// lib/db/snapshots.ts
// Thin CRUD over product_snapshots — same Supabase+memoryDb dual-path
// style as lib/db/documents.ts. A snapshot is never overwritten:
// re-capturing inserts a new row and the TDS document's snapshot_id is
// repointed to it (see lib/db/documents.ts's setDocumentSnapshot).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

export interface SnapshotRow {
  id: string;
  project_id: string;
  source_url: string | null;
  asin: string | null;
  raw_data: any;
  captured_at: string;
}

export async function insertSnapshot(input: {
  projectId: string;
  sourceUrl?: string | null;
  asin?: string | null;
  rawData: any;
}): Promise<SnapshotRow> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("product_snapshots")
      .insert({
        project_id: input.projectId,
        source_url: input.sourceUrl ?? null,
        asin: input.asin ?? null,
        raw_data: input.rawData ?? {},
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const row = {
    id: `snap_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    projectId: input.projectId,
    sourceUrl: input.sourceUrl ?? null,
    asin: input.asin ?? null,
    rawData: input.rawData ?? {},
    capturedAt: now,
  };
  memoryDb.productSnapshots.push(row);
  return { id: row.id, project_id: row.projectId, source_url: row.sourceUrl, asin: row.asin, raw_data: row.rawData, captured_at: now.toISOString() };
}

export async function getLatestSnapshot(projectId: string): Promise<SnapshotRow | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("product_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const rows = memoryDb.productSnapshots
    .filter(s => s.projectId === projectId)
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, project_id: row.projectId, source_url: row.sourceUrl, asin: row.asin, raw_data: row.rawData, captured_at: row.capturedAt.toISOString() };
}

export async function getSnapshotById(id: string): Promise<SnapshotRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("product_snapshots").select("*").eq("id", id).maybeSingle();
    return data;
  }

  const row = memoryDb.productSnapshots.find(s => s.id === id);
  if (!row) return null;
  return { id: row.id, project_id: row.projectId, source_url: row.sourceUrl, asin: row.asin, raw_data: row.rawData, captured_at: row.capturedAt.toISOString() };
}
