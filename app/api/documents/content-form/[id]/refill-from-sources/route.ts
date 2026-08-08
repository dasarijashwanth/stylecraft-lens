import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getDocumentById } from "@/lib/db/documents";
import { refillContentFormFromSources } from "@/lib/document-fill-engine";

export const maxDuration = 45;

// Automatic Source-Doc Fact Extraction & Cross-Document Fill — the manual
// "Fill blanks from sources" trigger for Content Form (genuinely new; no
// equivalent existed for this document before this feature). The actual
// fill logic lives in lib/document-fill-engine.ts, shared with the
// automatic upload-triggered chain (app/api/projects/[id]/fill-from-sources/
// continue) so both paths run the exact same code.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const document = await getDocumentById(params.id);
    if (!document || document.doc_type !== "content_form") return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const result = await refillContentFormFromSources(document.project_id, session.orgId, session.userId, session.email, Date.now());
    return NextResponse.json({ regenerated: result.regenerated, regeneratedFieldIds: result.changedFieldIds, factsRetried: result.factsRetried });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to re-fill from sources" }, { status: 500 });
  }
}
