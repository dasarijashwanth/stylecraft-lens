import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { generateProjectDeck } from "@/lib/deck-generate";
import { checkRateLimit } from "@/lib/rate-limit";

export const maxDuration = 55; // rendering + a possible condense AI call, comfortably under the 60s ceiling

// Regenerates a project's deck on demand — the staleness banner's "Regenerate"
// action and a plain manual re-run both call this. Defaults to whichever
// template is currently active (the common case: GTM changed, template
// didn't); an explicit templateId in the body pins a specific one instead
// (e.g. "regenerate with this version's original template").
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();

    // Security audit fix — deck rendering + a possible AI "condense" call
    // per request, previously unrated.
    const rateLimit = await checkRateLimit({ eventType: "deck_regenerate", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many deck regenerations — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const templateId: string | undefined = body?.templateId;

    const deck = await generateProjectDeck(params.id, session.orgId, session.userId, { templateId });
    return NextResponse.json({ deck });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to regenerate deck" }, { status: 500 });
  }
}
