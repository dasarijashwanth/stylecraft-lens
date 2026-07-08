import { NextRequest, NextResponse } from "next/server";
import { getDocumentById, getDocumentFields } from "@/lib/db/documents";
import { GTM_FIELD_SCHEMA } from "@/lib/gtm-field-schema";

// Reads only `params.id` — same latent Next.js route-handler-cache risk
// confirmed and fixed in app/api/projects/[id]/pipeline/route.ts.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const document = await getDocumentById(params.id);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const fields = await getDocumentFields(document.id);
    const completedCount = fields.filter(f => f.answer && f.answer.toUpperCase() !== "N/A").length;

    return NextResponse.json({
      document: { ...document, completedCount, totalFields: GTM_FIELD_SCHEMA.length },
      fields,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load document" }, { status: 500 });
  }
}
