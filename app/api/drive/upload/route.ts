import { NextRequest, NextResponse } from "next/server";
import { uploadToDrive } from "@/lib/google-drive";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";
import { getAuthSession } from "@/lib/auth";
import { renderDocumentPdf, DocType, DocumentNotFoundError } from "@/lib/pdf/render";
import { getDocumentByProject, getDocumentById, getDocumentFields, setDocumentDriveInfo, setDocumentXlsxDriveInfo } from "@/lib/db/documents";
import { getProject } from "@/lib/db/projects";
import { getLatestProjectDeck, getProjectDeckFileBuffer, setDeckDriveInfo } from "@/lib/db/project-decks";
import { listCatalogProducts } from "@/lib/db/catalog-products";
import { matchCatalogProductByName, resolveHeaderSku } from "@/lib/our-product-position";
import { getActiveGtmWorkbookTemplate, getGtmWorkbookTemplateFileBuffer } from "@/lib/db/gtm-workbook-templates";
import { renderGtmWorkbook, WorkbookFields } from "@/lib/gtm-workbook-data-mapper";

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Same convention as app/api/documents/gtm/[id]/export-xlsx/route.ts's own
// sanitizeFilename — duplicated here rather than shared/exported, matching
// this codebase's own "keep small helpers local" precedent.
function sanitizeFilename(value: string): string {
  return value.replace(/[/\\:*?"<>|]/g, "").trim() || "Product";
}

export const maxDuration = 30;

const DOC_TYPE_FOLDER: Record<DocType, string> = {
  "sales-kit": "Sales Kit",
  tds: "Technical Data Sheet",
  gtm: "Go-To-Market",
  "active-report": "Active Report",
};
const OUTPUT_TYPE_MAP: Record<string, "sales_kit" | "tds"> = { "sales-kit": "sales_kit", tds: "tds" };

type DriveTarget =
  | { kind: "output"; rowId: string; existingFileId: string | null; memory?: boolean }
  | { kind: "report"; rowId: string; existingFileId: string | null; memory?: boolean }
  | { kind: "document"; rowId: string; existingFileId: string | null };

async function resolveDriveTarget(docType: DocType, id: string, userId: string): Promise<DriveTarget | null> {
  if (docType === "sales-kit" || docType === "tds") {
    const outputType = OUTPUT_TYPE_MAP[docType];
    if (isSupabaseConfigured) {
      const { data } = await supabaseAdmin
        .from("project_outputs")
        .select("id, drive_file_id")
        .eq("project_id", id)
        .eq("output_type", outputType)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? { kind: "output", rowId: data.id, existingFileId: data.drive_file_id } : null;
    }
    const output = memoryDb.outputs
      .filter(o => o.projectId === id && o.outputType === outputType)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return output ? { kind: "output", rowId: output.id, existingFileId: output.driveFileId ?? null, memory: true } : null;
  }

  if (docType === "gtm") {
    const doc = await getDocumentByProject(id, "gtm");
    if (!doc) return null;
    return { kind: "document", rowId: doc.id, existingFileId: doc.drive_file_id ?? null };
  }

  // active-report
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("reports").select("id, drive_file_id").eq("id", id).maybeSingle();
    return data ? { kind: "report", rowId: data.id, existingFileId: data.drive_file_id } : null;
  }
  const report = memoryDb.reports.find(r => r.id === id);
  return report ? { kind: "report", rowId: report.id, existingFileId: report.driveFileId ?? null, memory: true } : null;
}

async function persistDriveInfo(target: DriveTarget, driveUrl: string, driveFileId: string) {
  if (target.kind === "output") {
    if (target.memory) {
      const output = memoryDb.outputs.find(o => o.id === target.rowId);
      if (output) { output.driveUrl = driveUrl; output.driveFileId = driveFileId; }
    } else {
      const { error } = await supabaseAdmin.from("project_outputs").update({ drive_url: driveUrl, drive_file_id: driveFileId }).eq("id", target.rowId);
      if (error) throw error;
    }
  } else if (target.kind === "report") {
    if (target.memory) {
      const report = memoryDb.reports.find(r => r.id === target.rowId);
      if (report) { report.driveUrl = driveUrl; report.driveFileId = driveFileId; }
    } else {
      const { error } = await supabaseAdmin.from("reports").update({ drive_url: driveUrl, drive_file_id: driveFileId }).eq("id", target.rowId);
      if (error) throw error;
    }
  } else if (target.kind === "document") {
    await setDocumentDriveInfo(target.rowId, driveUrl, driveFileId);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    const { docType, id, replace } = await req.json() as { docType: DocType | "deck" | "gtm-xlsx"; id: string; replace?: boolean };

    // Deck bytes are never rendered on demand — only via the pipeline's deck
    // phase or an explicit Regenerate action — so this just fetches the
    // latest already-generated file, unlike every other docType here.
    if (docType === "deck") {
      // getLatestProjectDeck/getProjectDeckFileBuffer have no org/user
      // awareness of their own (they fetch by project/deck id alone) — this
      // check is what actually enforces ownership; it must run BEFORE any
      // read below, not just be computed for the cosmetic projectName fallback.
      const project = await getProject(id, session.orgId);
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

      const deck = await getLatestProjectDeck(id);
      if (!deck || deck.status !== "complete") {
        return NextResponse.json({ error: "No completed deck found for this project" }, { status: 404 });
      }
      const buffer = await getProjectDeckFileBuffer(deck);

      const { fileId, webViewLink } = await uploadToDrive({
        content: buffer,
        fileName: deck.file_name || "ProjectDeck.pptx",
        mimeType: PPTX_MIME_TYPE,
        projectName: project?.name || project?.productName || "Stylecraft Project",
        outputType: "Project Deck",
        existingFileId: replace ? deck.drive_file_id ?? null : null,
      });

      await setDeckDriveInfo(deck.id, webViewLink, fileId);
      return NextResponse.json({ fileId, webViewLink, replaced: !!(replace && deck.drive_file_id) });
    }

    // The GTM XLSX workbook (not the PDF) — `id` here is the GTM document's
    // own id (the caller already has it on hand from ProductKnowledgeSection),
    // not the project id every other docType branch below uses. Builds the
    // same buffer app/api/documents/gtm/[id]/export-xlsx/route.ts does,
    // duplicated inline rather than shared — same "keep small
    // per-route assembly local" precedent as sanitizeFilename above.
    if (docType === "gtm-xlsx") {
      const document = await getDocumentById(id);
      if (!document || document.doc_type !== "gtm") {
        return NextResponse.json({ error: "GTM document not found" }, { status: 404 });
      }
      const project = await getProject(document.project_id, session.orgId);
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

      const template = await getActiveGtmWorkbookTemplate();
      if (!template) {
        return NextResponse.json({ error: "No active GTM workbook template configured — an admin needs to upload one first." }, { status: 400 });
      }

      const [docFields, catalogProducts, templateBuffer, contentFormDocument] = await Promise.all([
        getDocumentFields(document.id),
        listCatalogProducts(),
        getGtmWorkbookTemplateFileBuffer(template),
        getDocumentByProject(document.project_id, "content_form"),
      ]);
      const contentFormFields = contentFormDocument ? await getDocumentFields(contentFormDocument.id) : [];

      const matched = matchCatalogProductByName(project.productName, catalogProducts);
      const headerSku = resolveHeaderSku(project.productName, catalogProducts, (project as any).sku);

      const fields: WorkbookFields = {};
      for (const f of docFields) fields[f.field_id] = { answer: f.answer ?? "", notes: f.notes };
      for (const f of contentFormFields) fields[f.field_id] = { answer: f.answer ?? "", notes: f.notes };

      const result = renderGtmWorkbook(templateBuffer, {
        fields,
        headerSku,
        collection: matched?.collection ?? null,
        upc: matched?.upc ?? null,
      });

      const productLabel = sanitizeFilename(project.productName || project.name);
      const fileName = `${productLabel}${headerSku ? ` - ${sanitizeFilename(headerSku)}` : ""} — Go to Market.xlsx`;

      const { fileId, webViewLink } = await uploadToDrive({
        content: result.buffer,
        fileName,
        mimeType: XLSX_MIME_TYPE,
        projectName: project.name || project.productName || "Stylecraft Project",
        outputType: "Go-To-Market",
        existingFileId: replace ? document.xlsx_drive_file_id ?? null : null,
      });

      await setDocumentXlsxDriveInfo(document.id, webViewLink, fileId);
      return NextResponse.json({ fileId, webViewLink, replaced: !!(replace && document.xlsx_drive_file_id) });
    }

    const { buffer, productName, projectName, fileName } = await renderDocumentPdf(docType, id, session);
    const target = await resolveDriveTarget(docType, id, session.userId);

    const { fileId, webViewLink } = await uploadToDrive({
      content: buffer,
      fileName,
      mimeType: "application/pdf",
      projectName: projectName || productName || "Stylecraft Project",
      outputType: DOC_TYPE_FOLDER[docType],
      existingFileId: replace ? target?.existingFileId ?? null : null,
    });

    if (target) {
      await persistDriveInfo(target, webViewLink, fileId);
    }

    return NextResponse.json({ fileId, webViewLink, replaced: !!(replace && target?.existingFileId) });
  } catch (err: any) {
    const status = err instanceof DocumentNotFoundError ? err.status : 500;
    return NextResponse.json({ error: err.message || "Drive upload failed" }, { status });
  }
}
