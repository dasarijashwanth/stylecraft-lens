// lib/db/documents.ts
// Field-granular document storage — shared by doc_type='gtm' and
// doc_type='tds' (TDS moved off its old project_outputs blob onto this
// same model so it gets per-field editing/history/revert for free). See
// supabase_schema.sql for documents/document_fields/document_field_history.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockDocumentField } from "@/lib/memoryDb";

// Structural, not GTM-specific — lib/tds-field-schema.ts's TdsFieldAnswer
// satisfies this shape too, so one storage layer serves both documents.
export interface FieldAnswerLike {
  answer: string;
  source: string;
  sourceDetail?: any;
  flagged?: boolean;
}

export interface DocumentRow {
  id: string;
  project_id: string;
  doc_type: string;
  status: string;
  drive_url?: string | null;
  drive_file_id?: string | null;
  snapshot_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentFieldRow {
  id: string;
  document_id: string;
  field_id: string;
  section: string;
  question: string;
  answer: string | null;
  // The AI/derivation-generated value, preserved across manual edits to
  // `answer` — set only by an AI-driven save (full generation or per-field
  // regenerate), never by a plain manual edit. Lets a CSV export show the
  // pipeline's original answer alongside a hand-edited current value.
  ai_answer: string | null;
  source: string | null;
  source_detail: any;
  flagged: boolean;
  owner: string | null;
  notes: string | null;
  updated_at: string;
}

// Reshapes a document's field rows into a flat field_id -> answer map —
// what lib/gtm-derive.ts and lib/gtm-generate.ts consume for TDS-sourced
// GTM fields, and what the AI prompt's source-text blocks stringify.
export function flattenDocumentFields(fields: DocumentFieldRow[]): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const f of fields) {
    if (f.answer && f.answer.toUpperCase() !== "N/A" && f.answer !== "Not listed on product page") {
      flat[f.field_id] = f.answer;
    }
  }
  return flat;
}

// Convenience for GTM generation: the project's TDS document flattened to
// field_id -> answer, or null if no TDS has been captured yet.
export async function getTdsFieldsForProject(projectId: string): Promise<Record<string, string> | null> {
  const doc = await getDocumentByProject(projectId, "tds");
  if (!doc) return null;
  const fields = await getDocumentFields(doc.id);
  return flattenDocumentFields(fields);
}

export async function getDocumentByProject(projectId: string, docType: string): Promise<DocumentRow | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("*")
      .eq("project_id", projectId)
      .eq("doc_type", docType)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  const doc = memoryDb.documents.find(d => d.projectId === projectId && d.docType === docType);
  if (!doc) return null;
  return { id: doc.id, project_id: doc.projectId, doc_type: doc.docType, status: doc.status, drive_url: doc.driveUrl ?? null, drive_file_id: doc.driveFileId ?? null, snapshot_id: doc.snapshotId ?? null, created_at: doc.createdAt.toISOString(), updated_at: doc.updatedAt.toISOString() };
}

export async function getOrCreateDocument(projectId: string, docType: string): Promise<DocumentRow> {
  const existing = await getDocumentByProject(projectId, docType);
  if (existing) return existing;

  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("documents")
      .insert({ project_id: projectId, doc_type: docType, status: "draft" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const now = new Date();
  const doc = { id: `doc_${Date.now()}`, projectId, docType, status: "draft", driveUrl: null, driveFileId: null, snapshotId: null, createdAt: now, updatedAt: now };
  memoryDb.documents.push(doc);
  return { id: doc.id, project_id: doc.projectId, doc_type: doc.docType, status: doc.status, drive_url: null, drive_file_id: null, snapshot_id: null, created_at: now.toISOString(), updated_at: now.toISOString() };
}

export async function setDocumentDriveInfo(documentId: string, driveUrl: string, driveFileId: string) {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("documents").update({ drive_url: driveUrl, drive_file_id: driveFileId }).eq("id", documentId);
    if (error) throw error;
  } else {
    const doc = memoryDb.documents.find(d => d.id === documentId);
    if (doc) { doc.driveUrl = driveUrl; doc.driveFileId = driveFileId; }
  }
}

// Points a doc_type='tds' document at the snapshot it was (re)generated
// from — backs the "Live snapshot captured {captured_at}" header.
export async function setDocumentSnapshot(documentId: string, snapshotId: string) {
  if (isSupabaseConfigured) {
    const { error } = await supabaseAdmin.from("documents").update({ snapshot_id: snapshotId, updated_at: new Date().toISOString() }).eq("id", documentId);
    if (error) throw error;
  } else {
    const doc = memoryDb.documents.find(d => d.id === documentId);
    if (doc) { doc.snapshotId = snapshotId; doc.updatedAt = new Date(); }
  }
}

export async function getDocumentById(documentId: string): Promise<DocumentRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("documents").select("*").eq("id", documentId).maybeSingle();
    return data;
  }
  const doc = memoryDb.documents.find(d => d.id === documentId);
  if (!doc) return null;
  return { id: doc.id, project_id: doc.projectId, doc_type: doc.docType, status: doc.status, drive_url: doc.driveUrl ?? null, drive_file_id: doc.driveFileId ?? null, snapshot_id: doc.snapshotId ?? null, created_at: doc.createdAt.toISOString(), updated_at: doc.updatedAt.toISOString() };
}

// For the anti-boilerplate check: the most recently updated OTHER project's
// document of this type, so a newly-generated written field can be compared
// against what the last product got for the same field id.
export async function getMostRecentOtherDocumentFields(excludeProjectId: string, docType: string): Promise<DocumentFieldRow[]> {
  if (isSupabaseConfigured) {
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id")
      .eq("doc_type", docType)
      .neq("project_id", excludeProjectId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const docId = docs?.[0]?.id;
    if (!docId) return [];
    return getDocumentFields(docId);
  }
  const other = memoryDb.documents
    .filter(d => d.docType === docType && d.projectId !== excludeProjectId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (!other) return [];
  return getDocumentFields(other.id);
}

export async function getDocumentFields(documentId: string): Promise<DocumentFieldRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("document_fields").select("*").eq("document_id", documentId);
    if (error) throw error;
    return data ?? [];
  }
  return memoryDb.documentFields
    .filter(f => f.documentId === documentId)
    .map(f => ({
      id: f.id, document_id: f.documentId, field_id: f.fieldId, section: f.section, question: f.question,
      answer: f.answer, ai_answer: f.aiAnswer ?? null, source: f.source, source_detail: f.sourceDetail, flagged: f.flagged,
      owner: f.owner ?? "Product Marketing", notes: f.notes ?? null, updated_at: f.updatedAt.toISOString(),
    }));
}

async function writeHistory(documentFieldId: string, previousAnswer: string | null, changedBy: string | null) {
  if (isSupabaseConfigured) {
    await supabaseAdmin.from("document_field_history").insert({ document_field_id: documentFieldId, answer: previousAnswer, changed_by: changedBy });
  } else {
    memoryDb.documentFieldHistory.push({
      id: `dfh_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      documentFieldId,
      answer: previousAnswer,
      changedBy,
      changedAt: new Date(),
    });
  }
}

// Bulk-saves a full generation result: for each field, if a row already
// exists with a different answer, its OLD value is written to history
// before the row is updated — so every real change (not just edits) is
// captured in the audit trail.
// Batches all 74 field writes into (at most) two round trips instead of
// one upsert + one history-insert per field. The sequential per-field
// version was issuing 74-148 individual Supabase requests in a sitting
// `for` loop — measured at 80+ seconds by itself, which is what was
// pushing full GTM generation past Vercel's fixed 60s function timeout
// and surfacing to the user as a raw "FUNCTION_INVOCATION_TIMEOUT" page
// that the frontend then failed to JSON.parse.
export async function saveDocumentFields(
  documentId: string,
  fieldsBySchema: { id: string; section: string; question: string }[],
  answers: Record<string, FieldAnswerLike>,
  updatedBy: string | null
) {
  const existing = await getDocumentFields(documentId);
  const existingById = new Map(existing.map(f => [f.field_id, f]));
  const now = new Date().toISOString();

  const historyRows: { document_field_id: string; answer: string | null; changed_by: string | null }[] = [];
  const upsertRows: any[] = [];

  for (const f of fieldsBySchema) {
    const next = answers[f.id];
    if (!next) continue;
    const prior = existingById.get(f.id);
    // Regenerating/re-saving must never clobber a user-assigned Owner or
    // Notes — those are independent of the generated answer.
    const owner = prior?.owner ?? "Product Marketing";
    const notes = prior?.notes ?? null;

    if (prior && prior.answer !== next.answer) {
      historyRows.push({ document_field_id: prior.id, answer: prior.answer, changed_by: updatedBy });
    }

    if (isSupabaseConfigured) {
      upsertRows.push({
        document_id: documentId,
        field_id: f.id,
        section: f.section,
        question: f.question,
        answer: next.answer,
        ai_answer: next.answer,
        source: next.source,
        source_detail: next.sourceDetail ?? {},
        flagged: !!next.flagged,
        owner,
        notes,
        updated_by: updatedBy,
        updated_at: now,
      });
    } else {
      const idx = memoryDb.documentFields.findIndex(x => x.documentId === documentId && x.fieldId === f.id);
      const row: MockDocumentField = {
        id: prior?.id || `dfld_${Date.now()}_${f.id}`,
        documentId,
        fieldId: f.id,
        section: f.section,
        question: f.question,
        answer: next.answer,
        aiAnswer: next.answer,
        source: next.source,
        sourceDetail: next.sourceDetail ?? {},
        flagged: !!next.flagged,
        owner,
        notes,
        updatedBy,
        updatedAt: new Date(),
      };
      if (idx >= 0) memoryDb.documentFields[idx] = row;
      else memoryDb.documentFields.push(row);
    }
  }

  if (isSupabaseConfigured) {
    if (historyRows.length) {
      const { error } = await supabaseAdmin.from("document_field_history").insert(historyRows);
      if (error) throw error;
    }
    if (upsertRows.length) {
      const { error } = await supabaseAdmin.from("document_fields").upsert(upsertRows, { onConflict: "document_id,field_id" });
      if (error) throw error;
    }
    await supabaseAdmin.from("documents").update({ updated_at: now }).eq("id", documentId);
  } else {
    const doc = memoryDb.documents.find(d => d.id === documentId);
    if (doc) doc.updatedAt = new Date();
  }
}

// `opts` lets the regenerate endpoint persist the field's real source/flagged
// state instead of the plain-edit defaults (source unchanged, flagged
// cleared) that a manual textarea edit implies.
export async function updateDocumentField(
  documentId: string,
  fieldId: string,
  newAnswer: string,
  updatedBy: string | null,
  opts?: { source?: string; sourceDetail?: any; flagged?: boolean }
): Promise<DocumentFieldRow> {
  const fields = await getDocumentFields(documentId);
  const prior = fields.find(f => f.field_id === fieldId);
  if (!prior) throw new Error("Field not found");

  if (prior.answer !== newAnswer) {
    await writeHistory(prior.id, prior.answer, updatedBy);
  }

  // `opts` is only ever passed by the AI regenerate route — a plain manual
  // edit (opts omitted entirely) must never move ai_answer, so it keeps
  // reflecting whatever the pipeline last generated regardless of how many
  // times a human edits `answer` afterward.
  const update = {
    answer: newAnswer,
    ai_answer: opts !== undefined ? newAnswer : prior.ai_answer,
    source: opts?.source ?? prior.source,
    source_detail: opts?.sourceDetail ?? prior.source_detail,
    flagged: opts?.flagged ?? false,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("document_fields")
      .update(update)
      .eq("id", prior.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.documentFields.find(f => f.id === prior.id);
  if (row) {
    row.answer = newAnswer;
    row.aiAnswer = update.ai_answer;
    row.source = update.source;
    row.sourceDetail = update.source_detail;
    row.flagged = update.flagged;
    row.updatedBy = updatedBy;
    row.updatedAt = new Date();
  }
  return { ...prior, answer: newAnswer, ai_answer: update.ai_answer, source: update.source, source_detail: update.source_detail, flagged: update.flagged };
}

// Owner/Notes are metadata about the field, not the generated answer — an
// edit here is intentionally NOT written to document_field_history (that
// history is answer-specific), so this never interacts with revert.
export async function updateDocumentFieldMeta(
  documentId: string,
  fieldId: string,
  opts: { owner?: string; notes?: string },
  updatedBy: string | null
): Promise<DocumentFieldRow> {
  const fields = await getDocumentFields(documentId);
  const prior = fields.find(f => f.field_id === fieldId);
  if (!prior) throw new Error("Field not found");

  const update = {
    owner: opts.owner ?? prior.owner,
    notes: opts.notes ?? prior.notes,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("document_fields")
      .update(update)
      .eq("id", prior.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const row = memoryDb.documentFields.find(f => f.id === prior.id);
  if (row) {
    row.owner = update.owner;
    row.notes = update.notes;
    row.updatedBy = updatedBy;
    row.updatedAt = new Date();
  }
  return { ...prior, owner: update.owner, notes: update.notes };
}

// Restores the single most recent prior value from history — records the
// current (about-to-be-replaced) value as a new history entry first so the
// revert itself is undoable too.
export async function revertDocumentField(documentId: string, fieldId: string, updatedBy: string | null): Promise<DocumentFieldRow> {
  const fields = await getDocumentFields(documentId);
  const current = fields.find(f => f.field_id === fieldId);
  if (!current) throw new Error("Field not found");

  let previousAnswer: string | null = null;
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin
      .from("document_field_history")
      .select("answer")
      .eq("document_field_id", current.id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    previousAnswer = data?.answer ?? null;
  } else {
    const history = memoryDb.documentFieldHistory
      .filter(h => h.documentFieldId === current.id)
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
    previousAnswer = history[0]?.answer ?? null;
  }

  if (previousAnswer === null) throw new Error("No prior value to revert to");
  return updateDocumentField(documentId, fieldId, previousAnswer, updatedBy);
}
