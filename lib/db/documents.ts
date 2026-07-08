// lib/db/documents.ts
// Field-granular document storage (currently doc_type='gtm' only) — see
// supabase_schema.sql for documents/document_fields/document_field_history.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockDocumentField } from "@/lib/memoryDb";
import { GtmFieldAnswer } from "@/lib/gtm-field-schema";

export interface DocumentRow {
  id: string;
  project_id: string;
  doc_type: string;
  status: string;
  drive_url?: string | null;
  drive_file_id?: string | null;
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
  source: string | null;
  source_detail: any;
  flagged: boolean;
  updated_at: string;
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
  return { id: doc.id, project_id: doc.projectId, doc_type: doc.docType, status: doc.status, drive_url: doc.driveUrl ?? null, drive_file_id: doc.driveFileId ?? null, created_at: doc.createdAt.toISOString(), updated_at: doc.updatedAt.toISOString() };
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
  const doc = { id: `doc_${Date.now()}`, projectId, docType, status: "draft", driveUrl: null, driveFileId: null, createdAt: now, updatedAt: now };
  memoryDb.documents.push(doc);
  return { id: doc.id, project_id: doc.projectId, doc_type: doc.docType, status: doc.status, drive_url: null, drive_file_id: null, created_at: now.toISOString(), updated_at: now.toISOString() };
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

export async function getDocumentById(documentId: string): Promise<DocumentRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("documents").select("*").eq("id", documentId).maybeSingle();
    return data;
  }
  const doc = memoryDb.documents.find(d => d.id === documentId);
  if (!doc) return null;
  return { id: doc.id, project_id: doc.projectId, doc_type: doc.docType, status: doc.status, drive_url: doc.driveUrl ?? null, drive_file_id: doc.driveFileId ?? null, created_at: doc.createdAt.toISOString(), updated_at: doc.updatedAt.toISOString() };
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
      answer: f.answer, source: f.source, source_detail: f.sourceDetail, flagged: f.flagged, updated_at: f.updatedAt.toISOString(),
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
export async function saveDocumentFields(
  documentId: string,
  fieldsBySchema: { id: string; section: string; question: string }[],
  answers: Record<string, GtmFieldAnswer>,
  updatedBy: string | null
) {
  const existing = await getDocumentFields(documentId);
  const existingById = new Map(existing.map(f => [f.field_id, f]));

  for (const f of fieldsBySchema) {
    const next = answers[f.id];
    if (!next) continue;
    const prior = existingById.get(f.id);

    if (prior && prior.answer !== next.answer) {
      await writeHistory(prior.id, prior.answer, updatedBy);
    }

    if (isSupabaseConfigured) {
      await supabaseAdmin.from("document_fields").upsert(
        {
          document_id: documentId,
          field_id: f.id,
          section: f.section,
          question: f.question,
          answer: next.answer,
          source: next.source,
          source_detail: next.sourceDetail ?? {},
          flagged: !!next.flagged,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "document_id,field_id" }
      );
    } else {
      const idx = memoryDb.documentFields.findIndex(x => x.documentId === documentId && x.fieldId === f.id);
      const row: MockDocumentField = {
        id: prior?.id || `dfld_${Date.now()}_${f.id}`,
        documentId,
        fieldId: f.id,
        section: f.section,
        question: f.question,
        answer: next.answer,
        source: next.source,
        sourceDetail: next.sourceDetail ?? {},
        flagged: !!next.flagged,
        updatedBy,
        updatedAt: new Date(),
      };
      if (idx >= 0) memoryDb.documentFields[idx] = row;
      else memoryDb.documentFields.push(row);
    }
  }

  if (isSupabaseConfigured) {
    await supabaseAdmin.from("documents").update({ updated_at: new Date().toISOString() }).eq("id", documentId);
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

  const update = {
    answer: newAnswer,
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
    row.source = update.source;
    row.sourceDetail = update.source_detail;
    row.flagged = update.flagged;
    row.updatedBy = updatedBy;
    row.updatedAt = new Date();
  }
  return { ...prior, answer: newAnswer, source: update.source, source_detail: update.source_detail, flagged: update.flagged };
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
