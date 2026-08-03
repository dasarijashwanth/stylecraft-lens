import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, getDocumentFields } from "@/lib/db/documents";
import { listCatalogProducts } from "@/lib/db/catalog-products";
import { matchCatalogProductByName, resolveHeaderSku } from "@/lib/our-product-position";
import { getActiveGtmWorkbookTemplate, getGtmWorkbookTemplateFileBuffer } from "@/lib/db/gtm-workbook-templates";
import { renderGtmWorkbook, WorkbookFields } from "@/lib/gtm-workbook-data-mapper";

export const maxDuration = 30;

// Strips only characters that are actually invalid in a filename — the
// spec's exact convention ("{ProductName} - {SKU} — Go to Market.xlsx")
// keeps spaces/dashes/em-dashes, unlike the CSV export's more aggressive
// underscore-slugified name.
function sanitizeFilename(value: string): string {
  return value.replace(/[/\\:*?"<>|]/g, "").trim() || "Product";
}

// Produces the official 12-tab GTM workbook with Product Knowledge/BOX
// ONLY/Product FAQ filled from the project's current saved field data —
// every other tab exported byte-for-byte untouched (lib/gtm-workbook-
// render.ts). Renders from whatever's currently saved, same "always the
// latest data" convention as the CSV/PDF export siblings.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const document = await getDocumentById(params.id);
    if (!document || document.doc_type !== "gtm") {
      return NextResponse.json({ error: "GTM document not found" }, { status: 404 });
    }

    const session = await getAuthSession();
    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const template = await getActiveGtmWorkbookTemplate();
    if (!template) {
      return NextResponse.json({ error: "No active GTM workbook template configured — an admin needs to upload one first." }, { status: 400 });
    }

    const [docFields, catalogProducts, templateBuffer] = await Promise.all([
      getDocumentFields(document.id),
      listCatalogProducts(),
      getGtmWorkbookTemplateFileBuffer(template),
    ]);

    const matched = matchCatalogProductByName(project.productName, catalogProducts);
    const headerSku = resolveHeaderSku(project.productName, catalogProducts, (project as any).sku);

    const fields: WorkbookFields = {};
    for (const f of docFields) fields[f.field_id] = { answer: f.answer ?? "", notes: f.notes };

    const result = renderGtmWorkbook(templateBuffer, {
      fields,
      headerSku,
      collection: matched?.collection ?? null,
      upc: matched?.upc ?? null,
    });

    // Formula-cell overwrites (BOX ONLY's #REF!/mis-pointed cross-sheet
    // refs) are logged, never silently repaired-in-place — per spec, we
    // overwrite with a literal value and never attempt to fix the formula
    // chain itself.
    if (result.repairs.length > 0) {
      console.warn(`[gtm-workbook-export] repaired ${result.repairs.length} formula cell(s) for document ${document.id}:`, result.repairs);
    }
    if (result.unmapped.length > 0) {
      console.warn(`[gtm-workbook-export] ${result.unmapped.length} label(s) not found in the active template for document ${document.id}:`, result.unmapped);
    }

    const productLabel = sanitizeFilename(project.productName || project.name);
    const filename = `${productLabel}${headerSku ? ` - ${sanitizeFilename(headerSku)}` : ""} — Go to Market.xlsx`;
    // The spec's exact filename convention includes an em-dash — outside
    // plain ASCII, so Content-Disposition needs the RFC 5987 filename*
    // form (what every modern browser actually reads) alongside a
    // plain-ASCII filename= fallback for anything that doesn't.
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "-");

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to export GTM workbook" }, { status: 500 });
  }
}
