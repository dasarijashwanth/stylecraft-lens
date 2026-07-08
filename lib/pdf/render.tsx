import { renderToBuffer } from "@react-pdf/renderer";
import { getProject } from "@/lib/db/projects";
import { getReport } from "@/lib/db/reports";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { getSnapshotById } from "@/lib/db/snapshots";
import { getLatestOutput } from "@/lib/project-outputs";
import { UserSession } from "@/lib/auth";
import { SalesKitPdf } from "./SalesKitPdf";
import { TdsPdf } from "./TdsPdf";
import { GtmPdf } from "./GtmPdf";
import { ActiveReportPdf } from "./ActiveReportPdf";

export type DocType = "sales-kit" | "tds" | "gtm" | "active-report";

export class DocumentNotFoundError extends Error {
  status = 404;
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function pdfFileNameFor(docType: DocType, productName: string) {
  const label = { "sales-kit": "SalesKit", tds: "TDS", gtm: "GTM", "active-report": "ActiveReport" }[docType];
  const safeName = productName.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `${label}_${safeName}_${date}.pdf`;
}

// Shared by both the direct-download route (app/api/documents/[type]/[id]/export-pdf)
// and the Save-to-Drive route (app/api/drive/upload) — one render path so a
// downloaded PDF and a Drive-saved PDF are always byte-identical for the same state.
export async function renderDocumentPdf(
  docType: DocType,
  id: string,
  session: UserSession
): Promise<{ buffer: Buffer; productName: string; projectName?: string; fileName: string }> {
  let element: any;
  let productName = "Product";
  let projectName: string | undefined;

  if (docType === "sales-kit") {
    const project = await getProject(id, session.orgId);
    if (!project) throw new DocumentNotFoundError("Project not found");
    productName = project.productName;
    projectName = project.name;

    const content = await getLatestOutput(id, "sales_kit");
    if (!content) throw new DocumentNotFoundError("No sales-kit generated for this project yet");

    element = <SalesKitPdf productName={productName} projectName={projectName} kit={content} />;
  } else if (docType === "tds") {
    const project = await getProject(id, session.orgId);
    if (!project) throw new DocumentNotFoundError("Project not found");
    productName = project.productName;
    projectName = project.name;

    const doc = await getDocumentByProject(id, "tds");
    const rows = doc ? await getDocumentFields(doc.id) : [];
    if (rows.length === 0) {
      throw new DocumentNotFoundError("No TDS snapshot captured for this project yet");
    }
    const fields: Record<string, { answer: string; source: string; owner?: string | null; notes?: string | null }> = {};
    for (const r of rows) fields[r.field_id] = { answer: r.answer || "Not listed on product page", source: r.source || "none", owner: r.owner, notes: r.notes };

    let capturedAt: string | null = null;
    let sourceDomain: string | null = null;
    if (doc?.snapshot_id) {
      const snapshot = await getSnapshotById(doc.snapshot_id);
      if (snapshot) {
        capturedAt = snapshot.captured_at;
        sourceDomain = snapshot.source_url ? safeDomain(snapshot.source_url) : (snapshot.asin ? `Amazon (${snapshot.asin})` : null);
      }
    }

    element = <TdsPdf productName={productName} projectName={projectName} capturedAt={capturedAt} sourceDomain={sourceDomain} fields={fields} />;
  } else if (docType === "gtm") {
    const project = await getProject(id, session.orgId);
    if (!project) throw new DocumentNotFoundError("Project not found");
    productName = project.productName;
    projectName = project.name;

    const doc = await getDocumentByProject(id, "gtm");
    const rows = doc ? await getDocumentFields(doc.id) : [];
    if (rows.length === 0) {
      throw new DocumentNotFoundError("No Go-To-Market data generated for this project yet");
    }
    const fields: Record<string, { answer: string; source: string; owner?: string | null; notes?: string | null }> = {};
    for (const r of rows) fields[r.field_id] = { answer: r.answer || "N/A", source: r.source || "none", owner: r.owner, notes: r.notes };
    element = <GtmPdf productName={productName} projectName={projectName} productKnowledge={{ fields }} />;
  } else if (docType === "active-report") {
    const report = await getReport(id, session.userId);
    if (!report) throw new DocumentNotFoundError("Report not found");
    productName = report.projects?.product_name || report.title || "Product";
    projectName = report.projects?.name;
    element = <ActiveReportPdf productName={productName} projectName={projectName} report={report} />;
  } else {
    throw new DocumentNotFoundError("Unknown document type");
  }

  const buffer = await renderToBuffer(element);
  return { buffer, productName, projectName, fileName: pdfFileNameFor(docType, productName) };
}
