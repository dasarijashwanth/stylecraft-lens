import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getDocumentById } from "@/lib/db/documents";
import { getProject } from "@/lib/db/projects";
import { refillGtmFromSources } from "@/lib/document-fill-engine";
import { checkRateLimit } from "@/lib/rate-limit";

export const maxDuration = 60; // was 45 - lib/document-fill-engine.ts now gates its own phases against a 48s budget, but the route should still allow the full Vercel Hobby ceiling as margin.

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

    // Security audit fix — this route can fire MANY real AI calls in a
    // single request (regenerate-if-blank across the whole field schema),
    // so it gets a tighter cap than a single-field regenerate.
    const rateLimit = await checkRateLimit({ eventType: "gtm_refill_sources", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many re-fill requests — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const document = await getDocumentById(params.id);
    if (!document || document.doc_type !== "gtm") return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // Security audit fix — this route used to rely ENTIRELY on
    // refillGtmFromSources's own internal getProject/orgId check (it does
    // enforce it, so a cross-org call never actually succeeded) rather than
    // checking ownership here at the route boundary like every sibling
    // route in this directory (fields/[fieldId], export-csv, export-xlsx)
    // does. That created a same-org-only 404-vs-500 existence oracle (a
    // wrong-org document id 500'd from deep inside the engine instead of
    // 404ing here) and left the ownership guarantee resting on a single,
    // easily-trimmed-as-"redundant" check inside a shared engine function
    // that's also called by trusted, session-less service-role scripts.
    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Document not found" }, { status: 404 });

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
