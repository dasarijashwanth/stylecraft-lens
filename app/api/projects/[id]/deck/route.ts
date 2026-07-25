import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentByProject, getDocumentFields } from "@/lib/db/documents";
import { listProjectDecks, getGtmLastEditedAt } from "@/lib/db/project-decks";

export const maxDuration = 20;
export const dynamic = "force-dynamic";

// Metadata/history read for the Project Deck tab — never touches deck
// bytes (see .../deck/download for that). Also returns a freshly-computed
// gtmLastEditedAt so the client can detect staleness against whichever
// deck version it's showing (each deck row already stores the
// gtm_snapshot_at it was generated from).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [decks, gtmDoc] = await Promise.all([
      listProjectDecks(params.id),
      getDocumentByProject(params.id, "gtm"),
    ]);

    let gtmLastEditedAt: string | null = null;
    if (gtmDoc) {
      const fields = await getDocumentFields(gtmDoc.id);
      gtmLastEditedAt = getGtmLastEditedAt(gtmDoc, fields);
    }

    return NextResponse.json({ decks, gtmLastEditedAt });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load deck info" }, { status: 500 });
  }
}
