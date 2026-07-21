import { NextResponse } from "next/server";
import { getGenerationState, startGenerationState } from "@/lib/db/generation-state";
import { getDocumentByProject } from "@/lib/db/documents";

// This GET handler only reads `params.id` (no searchParams/cookies/headers
// usage), which Next.js's route handler cache treats as eligible for
// static caching by default — confirmed via a real stuck-"pending" repro
// where this endpoint kept serving its first-ever response long after the
// underlying project_generation_state row had actually advanced. Force
// dynamic so every call reads the live DB state.
export const dynamic = "force-dynamic";

// Lets the project detail page decide whether to mount
// ProjectGenerationProgress on load — null means no pipeline was ever
// started for this project (no product anchor was given at creation).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    let state = await getGenerationState(params.id);

    // Self-heal, precisely gated: a missing state row for a project that
    // ALSO has no GTM document yet is almost certainly a brand-new project
    // that hit startGenerationState's silent-swallow failure at creation
    // time (see app/api/projects/route.ts) — safe to auto-start. A missing
    // row on a project that already has a GTM doc is a LEGACY project that
    // predates the auto-pipeline entirely (confirmed via a live production
    // check: 10 of 12 existing projects are exactly this case) — those must
    // go through the deliberate, separately-run backfill script instead;
    // silently auto-starting here would spend real API credits the instant
    // an admin merely opens an old project's page.
    if (!state) {
      const gtmDoc = await getDocumentByProject(params.id, "gtm");
      if (!gtmDoc) {
        state = await startGenerationState(params.id);
      }
    }

    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load pipeline state" }, { status: 500 });
  }
}
