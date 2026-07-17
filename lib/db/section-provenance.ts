// lib/db/section-provenance.ts
// Thin CRUD over section_provenance — same Supabase+memoryDb dual-path
// style as lib/db/snapshots.ts. Append-only: a fresh resolver run always
// INSERTs a new row (never UPDATE/upsert), so getLatestProvenance's
// "order by resolved_at desc, limit 1" is what always answers "what's the
// current trail for this section."
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";
import type { ProvenanceSection, ProvenanceTier, ProvenanceQuery } from "@/lib/section-provenance";

export interface ProvenanceRow {
  id: string;
  product_key: string;
  section: string;
  analysis_id: string | null;
  product_name: string | null;
  tiers: ProvenanceTier[];
  queries: ProvenanceQuery[];
  resolved_at: string;
}

export async function insertProvenance(input: {
  productKey: string;
  section: ProvenanceSection;
  analysisId?: string | null;
  productName?: string | null;
  tiers: ProvenanceTier[];
  queries: ProvenanceQuery[];
}): Promise<ProvenanceRow> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("section_provenance")
      .insert({
        product_key: input.productKey,
        section: input.section,
        analysis_id: input.analysisId ?? null,
        product_name: input.productName ?? null,
        tiers: input.tiers ?? [],
        queries: input.queries ?? [],
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const row = {
    id: `prov_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    productKey: input.productKey,
    section: input.section,
    analysisId: input.analysisId ?? null,
    productName: input.productName ?? null,
    tiers: input.tiers ?? [],
    queries: input.queries ?? [],
    resolvedAt: now,
  };
  memoryDb.sectionProvenance.push(row);
  return {
    id: row.id,
    product_key: row.productKey,
    section: row.section,
    analysis_id: row.analysisId,
    product_name: row.productName,
    tiers: row.tiers,
    queries: row.queries,
    resolved_at: now.toISOString(),
  };
}

export async function getLatestProvenance(productKey: string, section: string): Promise<ProvenanceRow | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("section_provenance")
      .select("*")
      .eq("product_key", productKey)
      .eq("section", section)
      .order("resolved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const rows = memoryDb.sectionProvenance
    .filter(r => r.productKey === productKey && r.section === section)
    .sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime());
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, product_key: row.productKey, section: row.section,
    analysis_id: row.analysisId, product_name: row.productName,
    tiers: row.tiers, queries: row.queries, resolved_at: row.resolvedAt.toISOString(),
  };
}

// All 4 sections' latest rows for one product in one call — useful when
// copying a competitor's full trail into a saved report at report-save
// time (lib/db/reports.ts), rather than 4 separate lookups.
export async function getAllLatestProvenance(productKey: string): Promise<Record<string, ProvenanceRow>> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("section_provenance")
      .select("*")
      .eq("product_key", productKey)
      .order("resolved_at", { ascending: false });
    if (error) throw error;
    const out: Record<string, ProvenanceRow> = {};
    for (const row of data || []) {
      if (!out[row.section]) out[row.section] = row;
    }
    return out;
  }

  const rows = memoryDb.sectionProvenance
    .filter(r => r.productKey === productKey)
    .sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime());
  const out: Record<string, ProvenanceRow> = {};
  for (const row of rows) {
    if (out[row.section]) continue;
    out[row.section] = {
      id: row.id, product_key: row.productKey, section: row.section,
      analysis_id: row.analysisId, product_name: row.productName,
      tiers: row.tiers, queries: row.queries, resolved_at: row.resolvedAt.toISOString(),
    };
  }
  return out;
}
