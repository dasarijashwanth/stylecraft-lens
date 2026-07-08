import { renderToBuffer } from "@react-pdf/renderer";
import { getProject } from "@/lib/db/projects";
import { getReport } from "@/lib/db/reports";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { getLatestOutput } from "@/lib/project-outputs";
import { UserSession } from "@/lib/auth";
import { SalesKitPdf } from "./SalesKitPdf";
import { TdsPdf } from "./TdsPdf";
import { GtmPdf } from "./GtmPdf";
import { ActiveReportPdf } from "./ActiveReportPdf";

export type DocType = "sales-kit" | "tds" | "gtm" | "active-report";
const OUTPUT_TYPE_MAP: Record<string, "sales_kit" | "tds"> = { "sales-kit": "sales_kit", tds: "tds" };

export class DocumentNotFoundError extends Error {
  status = 404;
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

  if (docType === "sales-kit" || docType === "tds") {
    const project = await getProject(id, session.orgId);
    if (!project) throw new DocumentNotFoundError("Project not found");
    productName = project.productName;
    projectName = project.name;

    const content = await getLatestOutput(id, OUTPUT_TYPE_MAP[docType]);
    if (!content) throw new DocumentNotFoundError(`No ${docType} generated for this project yet`);

    element = docType === "sales-kit"
      ? <SalesKitPdf productName={productName} projectName={projectName} kit={content} />
      : <TdsPdf productName={productName} projectName={projectName} tds={content} />;
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
    const fields: Record<string, { answer: string; source: string }> = {};
    for (const r of rows) fields[r.field_id] = { answer: r.answer || "N/A", source: r.source || "none" };
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
