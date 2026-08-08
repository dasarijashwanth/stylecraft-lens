// lib/db/extracted-facts.ts
// CRUD over extracted_facts — structured facts extracted from an
// uploaded_source_docs row (see lib/tds-doc-facts.ts), plus the merge that
// turns "every active doc's facts" into the single per-field answer the
// GTM fill ladder actually reads (lib/gtm-uploaded-tds.ts).
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockExtractedFact } from "@/lib/memoryDb";
import { listActiveDocsForProject, SourceDocType, UploadedSourceDocRow } from "./uploaded-source-docs";

// 'grounded_field' = schema-field-id-bound (spec values — deterministic
// synonym-map matches AND the AI sweep's schema-targeted extraction both
// land here). 'narrative_signal' = free-form marketing facts (taglines/
// USPs/audience statements) that don't map to a fixed schema field id, keyed
// by a synthesized slug in field_id instead. See supabase_schema.sql
// Section 53.
export type FactType = "grounded_field" | "narrative_signal";
export type FactConfidence = "high" | "medium" | "low";

export interface ExtractedFactRow {
  id: string;
  source_doc_id: string;
  project_id: string;
  field_id: string;
  value: string;
  raw_text: string | null;
  source_location: string | null;
  confirmed_by_user: boolean;
  fact_type: FactType;
  confidence: FactConfidence;
  created_at: string;
  updated_at: string;
}

function mockToRow(f: MockExtractedFact): ExtractedFactRow {
  return {
    id: f.id,
    source_doc_id: f.sourceDocId,
    project_id: f.projectId,
    field_id: f.fieldId,
    value: f.value,
    raw_text: f.rawText,
    source_location: f.sourceLocation,
    confirmed_by_user: f.confirmedByUser,
    fact_type: (f.factType as FactType) || "grounded_field",
    confidence: (f.confidence as FactConfidence) || "medium",
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

export async function listFactsForDoc(sourceDocId: string): Promise<ExtractedFactRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("extracted_facts").select("*").eq("source_doc_id", sourceDocId);
    if (error) throw error;
    return data || [];
  }
  return memoryDb.extractedFacts.filter(f => f.sourceDocId === sourceDocId).map(mockToRow);
}

export interface UpsertFactInput {
  field_id: string;
  value: string;
  raw_text?: string | null;
  source_location?: string | null;
  confirmed_by_user?: boolean;
  fact_type?: FactType;
  confidence?: FactConfidence;
}

// Inserts/updates facts for a doc, keyed by (source_doc_id, field_id) —
// never touches a field this same doc doesn't mention.
export async function upsertFacts(sourceDocId: string, projectId: string, facts: UpsertFactInput[]): Promise<void> {
  if (facts.length === 0) return;

  if (isSupabaseConfigured) {
    const rows = facts.map(f => ({
      source_doc_id: sourceDocId,
      project_id: projectId,
      field_id: f.field_id,
      value: f.value,
      raw_text: f.raw_text ?? null,
      source_location: f.source_location ?? null,
      confirmed_by_user: f.confirmed_by_user ?? false,
      fact_type: f.fact_type ?? "grounded_field",
      confidence: f.confidence ?? "medium",
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin.from("extracted_facts").upsert(rows, { onConflict: "source_doc_id,field_id" });
    if (error) throw error;
    return;
  }

  const now = new Date();
  for (const f of facts) {
    const existing = memoryDb.extractedFacts.find(x => x.sourceDocId === sourceDocId && x.fieldId === f.field_id);
    if (existing) {
      existing.value = f.value;
      existing.rawText = f.raw_text ?? null;
      existing.sourceLocation = f.source_location ?? null;
      existing.confirmedByUser = f.confirmed_by_user ?? existing.confirmedByUser;
      existing.factType = f.fact_type ?? existing.factType ?? "grounded_field";
      existing.confidence = f.confidence ?? existing.confidence ?? "medium";
      existing.updatedAt = now;
    } else {
      memoryDb.extractedFacts.push({
        id: `extfact_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        sourceDocId,
        projectId,
        fieldId: f.field_id,
        value: f.value,
        rawText: f.raw_text ?? null,
        sourceLocation: f.source_location ?? null,
        confirmedByUser: f.confirmed_by_user ?? false,
        factType: f.fact_type ?? "grounded_field",
        confidence: f.confidence ?? "medium",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

// A human's explicit correction/addition — always confirmed_by_user: true,
// highest authority in the merge below regardless of which doc type it's
// attached to.
export async function confirmFact(
  sourceDocId: string,
  projectId: string,
  fieldId: string,
  input: { value: string; rawText?: string | null; sourceLocation?: string | null }
): Promise<void> {
  await upsertFacts(sourceDocId, projectId, [
    { field_id: fieldId, value: input.value, raw_text: input.rawText ?? null, source_location: input.sourceLocation ?? null, confirmed_by_user: true },
  ]);
}

// Replacing a doc versions it (lib/db/uploaded-source-docs.ts) — a user's
// prior confirmed correction must survive that replacement rather than
// silently vanishing. Copies only confirmed_by_user:true facts from the
// old version onto the new one (same field_id); the extraction preview
// flags these as "carried over" so a genuine conflict with the new
// document's own content is still visible to the user.
export async function carryForwardConfirmedFacts(fromSourceDocId: string, toSourceDocId: string, projectId: string): Promise<void> {
  const priorFacts = await listFactsForDoc(fromSourceDocId);
  const confirmed = priorFacts.filter(f => f.confirmed_by_user);
  if (confirmed.length === 0) return;

  await upsertFacts(
    toSourceDocId,
    projectId,
    confirmed.map(f => ({
      field_id: f.field_id,
      value: f.value,
      raw_text: f.raw_text,
      source_location: f.source_location,
      confirmed_by_user: true,
    }))
  );
}

export interface MergedFact {
  field_id: string;
  value: string;
  raw_text: string | null;
  source_location: string | null;
  doc_type: SourceDocType;
  source_doc_id: string;
  source_file_name: string | null;
  confirmed_by_user: boolean;
}

// Doc-type priority when two active docs answer the SAME field — TDS is
// the most authoritative external source, a generic "Other" upload the
// least. A confirmed_by_user fact always wins regardless of this order
// (a human's explicit override is never second-guessed by doc type).
const DOC_TYPE_PRIORITY: Record<SourceDocType, number> = { tds: 0, spec_sheet: 1, sales_kit: 2, other: 3 };

export interface MergedProjectFacts {
  factsByFieldId: Record<string, MergedFact>;
  fullTextBlocks: string[];
  docsUsed: { docType: SourceDocType; id: string; version: number }[];
}

// Merges every active doc's facts for a project into the single per-field
// answer the GTM fill ladder reads (lib/gtm-uploaded-tds.ts). Called once
// per generation run.
export async function getMergedFactsForProject(projectId: string): Promise<MergedProjectFacts> {
  const activeDocs: UploadedSourceDocRow[] = await listActiveDocsForProject(projectId);
  if (activeDocs.length === 0) {
    return { factsByFieldId: {}, fullTextBlocks: [], docsUsed: [] };
  }

  const factsByFieldId: Record<string, MergedFact> = {};

  for (const doc of activeDocs) {
    const facts = await listFactsForDoc(doc.id);
    for (const f of facts) {
      const candidate: MergedFact = {
        field_id: f.field_id,
        value: f.value,
        raw_text: f.raw_text,
        source_location: f.source_location,
        doc_type: doc.doc_type,
        source_doc_id: doc.id,
        source_file_name: doc.file_name,
        confirmed_by_user: f.confirmed_by_user,
      };
      const existing = factsByFieldId[f.field_id];
      if (!existing) {
        factsByFieldId[f.field_id] = candidate;
        continue;
      }
      // A confirmed fact always wins over an unconfirmed one; between two
      // confirmed (or two unconfirmed) facts, lower doc-type priority wins.
      if (candidate.confirmed_by_user && !existing.confirmed_by_user) {
        factsByFieldId[f.field_id] = candidate;
      } else if (candidate.confirmed_by_user === existing.confirmed_by_user && DOC_TYPE_PRIORITY[candidate.doc_type] < DOC_TYPE_PRIORITY[existing.doc_type]) {
        factsByFieldId[f.field_id] = candidate;
      }
    }
  }

  return {
    factsByFieldId,
    fullTextBlocks: activeDocs.map(d => d.full_text || "").filter(Boolean),
    docsUsed: activeDocs.map(d => ({ docType: d.doc_type, id: d.id, version: d.version })),
  };
}

export interface FactConflict {
  field_id: string;
  candidates: MergedFact[];
  // The candidate getMergedFactsForProject would currently auto-resolve to
  // (confirmed-wins, else doc-type priority) — auto-fill never blocks on an
  // unresolved conflict, it just uses this one until a user picks.
  auto_resolved_source_doc_id: string;
}

function normalizeFactValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

// Two values "conflict" if they're not the same after normalization, and
// (for values that parse as plain numbers) not within a small rounding
// tolerance either — "7200" vs "7,200 RPM" must NOT be flagged as a
// conflict, "7200" vs "7500" must.
function valuesConflict(a: string, b: string): boolean {
  const normA = normalizeFactValue(a);
  const normB = normalizeFactValue(b);
  if (normA === normB) return false;

  const numA = parseFloat(normA.replace(/[^0-9.\-]/g, ""));
  const numB = parseFloat(normB.replace(/[^0-9.\-]/g, ""));
  if (!isNaN(numA) && !isNaN(numB) && /^[0-9.,\-\s]*[0-9](\s*\w+)?$/.test(normA.replace(/,/g, "")) && /^[0-9.,\-\s]*[0-9](\s*\w+)?$/.test(normB.replace(/,/g, ""))) {
    if (numA === 0 && numB === 0) return false;
    const denom = Math.max(Math.abs(numA), Math.abs(numB), 1);
    return Math.abs(numA - numB) / denom > 0.01;
  }
  return true;
}

// Every field_id where 2+ active docs disagree beyond normalization
// tolerance — a NEW cross-document view (no such thing existed before this
// feature; the existing per-file preview panel only ever shows one file's
// facts at a time). Never blocks the automatic fill (which keeps using
// getMergedFactsForProject's existing confirmed-wins/doc-type-priority
// resolution) — this is purely for surfacing + one-click resolution via the
// existing confirmFact write-back (a confirmed fact already wins the merge
// everywhere, so picking a candidate here requires no new propagation logic).
export async function findFactConflicts(projectId: string): Promise<FactConflict[]> {
  const activeDocs: UploadedSourceDocRow[] = await listActiveDocsForProject(projectId);
  if (activeDocs.length < 2) return [];

  const byFieldId = new Map<string, MergedFact[]>();
  for (const doc of activeDocs) {
    const facts = await listFactsForDoc(doc.id);
    for (const f of facts) {
      const candidate: MergedFact = {
        field_id: f.field_id,
        value: f.value,
        raw_text: f.raw_text,
        source_location: f.source_location,
        doc_type: doc.doc_type,
        source_doc_id: doc.id,
        source_file_name: doc.file_name,
        confirmed_by_user: f.confirmed_by_user,
      };
      const list = byFieldId.get(f.field_id) || [];
      list.push(candidate);
      byFieldId.set(f.field_id, list);
    }
  }

  const conflicts: FactConflict[] = [];
  for (const fieldId of Array.from(byFieldId.keys())) {
    const candidates: MergedFact[] = byFieldId.get(fieldId)!;
    if (candidates.length < 2) continue;
    // Already-confirmed facts are settled, not a conflict — a user already
    // picked. If NONE is confirmed and any pair of values genuinely
    // disagrees, surface the whole candidate set.
    if (candidates.some((c: MergedFact) => c.confirmed_by_user)) continue;
    const hasDisagreement = candidates.some((c: MergedFact, i: number) => candidates.some((other: MergedFact, j: number) => i !== j && valuesConflict(c.value, other.value)));
    if (!hasDisagreement) continue;

    const autoResolved = [...candidates].sort((a: MergedFact, b: MergedFact) => DOC_TYPE_PRIORITY[a.doc_type] - DOC_TYPE_PRIORITY[b.doc_type])[0];
    conflicts.push({ field_id: fieldId, candidates, auto_resolved_source_doc_id: autoResolved.source_doc_id });
  }
  return conflicts;
}
