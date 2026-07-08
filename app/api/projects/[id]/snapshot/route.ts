import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { captureProductSnapshot } from "@/lib/snapshot-capture";
import { generateTdsFields } from "@/lib/tds-generate";
import { getOrCreateDocument, saveDocumentFields, setDocumentSnapshot, getDocumentFields } from "@/lib/db/documents";
import { TDS_FIELD_SCHEMA } from "@/lib/tds-field-schema";

export const maxDuration = 60;

// The explicit "(re-)capture snapshot" action — captures real product data
// and regenerates the whole TDS from it in one call. This is the ONLY way
// TDS content changes after initial capture; there is deliberately no
// per-field or whole-document "regenerate from AI" path anywhere else in
// this API surface (see the absent .../tds/[id]/fields/[fieldId]/regenerate
// route). Re-capturing never overwrites the prior snapshot row — it
// inserts a new one and repoints documents.snapshot_id at it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    let body: any = {};
    try { body = await req.json(); } catch {}

    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // productUrl/asin only exist on the Supabase/memoryDb project shape,
    // not Prisma's (that fallback path was never given these columns —
    // same precedent as documents/document_fields/product_snapshots,
    // which also live outside Prisma's schema).
    const projectAny = project as any;
    const productUrl: string | null = body.productUrl ?? projectAny.productUrl ?? null;
    const asin: string | null = body.asin ?? projectAny.asin ?? null;
    if (!productUrl && !asin) {
      return NextResponse.json({ error: "This project has no product URL or ASIN to capture — add one first" }, { status: 400 });
    }

    const { snapshot, projection } = await captureProductSnapshot({ projectId: params.id, productUrl, asin });

    const productTitle = projection.title || project.productName;
    const fields = await generateTdsFields(productTitle, snapshot.raw_data, {
      productName: project.productName,
      description: project.description,
      category: project.category,
      motorTech: project.motorTech,
      keyDiff: project.keyDiff,
      pricePoint: project.pricePoint,
      companyContext: project.companyContext,
    });

    const document = await getOrCreateDocument(params.id, "tds");
    await saveDocumentFields(document.id, TDS_FIELD_SCHEMA, fields, session.userId);
    await setDocumentSnapshot(document.id, snapshot.id);

    const savedFields = await getDocumentFields(document.id);
    const completedCount = savedFields.filter(f => f.answer && f.answer.toUpperCase() !== "N/A" && f.answer !== "Not listed on product page").length;

    return NextResponse.json({
      document: {
        ...document,
        snapshot_id: snapshot.id,
        completedCount,
        totalFields: TDS_FIELD_SCHEMA.length,
        snapshot_captured_at: snapshot.captured_at,
        snapshot_source_url: snapshot.source_url,
        snapshot_asin: snapshot.asin,
      },
      fields: savedFields,
      snapshot,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to capture snapshot" }, { status: 500 });
  }
}
