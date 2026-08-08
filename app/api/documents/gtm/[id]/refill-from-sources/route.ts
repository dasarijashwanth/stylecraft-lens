import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getDocumentById } from "@/lib/db/documents";
import { refillGtmFromSources } from "@/lib/document-fill-engine";

export const maxDuration = 45;

// Uploaded TDS Ingestion, Part 5 (extended by the Automatic Source-Doc Fact
// Extraction & Cross-Document Fill feature) — the manual "Fill blanks from
// sources" trigger for the GTM document. The actual fill logic (grounded
// spec-field override, Marketing Direction/Product FAQ narrative regenerate-
// if-blank, Box Only regenerate-if-blank) lives in lib/document-fill-engine.ts,
// shared with the automatic upload-triggered chain
// (app/api/projects/[id]/fill-from-sources/continue) so both paths run the
// exact same code.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const document = await getDocumentById(params.id);
    if (!document || document.doc_type !== "gtm") return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const result = await refillGtmFromSources(document.project_id, session.orgId, session.userId, session.email, Date.now());
    return NextResponse.json({
      checked: result.filled,
      changed: result.filled,
      changedFieldIds: result.changedFieldIds,
      regenerated: result.regenerated,
      factsRetried: result.factsRetried,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to re-fill from sources" }, { status: 500 });
  }
}
