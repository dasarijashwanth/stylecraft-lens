import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getDocumentById } from "@/lib/db/documents";
import { getProject } from "@/lib/db/projects";
import { refillContentFormFromSources } from "@/lib/document-fill-engine";
import { checkRateLimit } from "@/lib/rate-limit";

export const maxDuration = 60; // was 45 - lib/document-fill-engine.ts now gates its own phases against a 48s budget, but the route should still allow the full Vercel Hobby ceiling as margin.

// Automatic Source-Doc Fact Extraction & Cross-Document Fill — the manual
// "Fill blanks from sources" trigger for Content Form (genuinely new; no
// equivalent existed for this document before this feature). The actual
// fill logic lives in lib/document-fill-engine.ts, shared with the
// automatic upload-triggered chain (app/api/projects/[id]/fill-from-sources/
// continue) so both paths run the exact same code.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();

    // Security audit fix — same reasoning as the GTM refill-from-sources
    // sibling route's rate limit.
    const rateLimit = await checkRateLimit({ eventType: "content_form_refill_sources", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many re-fill requests — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const document = await getDocumentById(params.id);
    if (!document || document.doc_type !== "content_form") return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // Security audit fix — explicit route-boundary ownership check, same
    // reasoning as the GTM refill-from-sources sibling route's fix.
    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const result = await refillContentFormFromSources(document.project_id, session.orgId, session.userId, session.email, Date.now());
    return NextResponse.json({ regenerated: result.regenerated, regeneratedFieldIds: result.changedFieldIds, factsRetried: result.factsRetried });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to re-fill from sources" }, { status: 500 });
  }
}
