import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getLatestProjectDeck, getProjectDeckById, getProjectDeckFileBuffer } from "@/lib/db/project-decks";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Streams an already-generated deck's bytes — modeled on
// app/api/documents/[type]/[id]/export-pdf/route.tsx's binary-streaming
// pattern. Never renders on demand (that only happens via the pipeline's
// deck phase or an explicit Regenerate action).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const versionId = req.nextUrl.searchParams.get("version");
    const deck = versionId ? await getProjectDeckById(versionId) : await getLatestProjectDeck(params.id);

    if (!deck || deck.project_id !== params.id) {
      return NextResponse.json({ error: "No deck found for this project" }, { status: 404 });
    }
    if (deck.status !== "complete") {
      return NextResponse.json({ error: `Deck is not ready yet (status: ${deck.status})` }, { status: 409 });
    }

    const buffer = await getProjectDeckFileBuffer(deck);
    const fileName = deck.file_name || `Deck_${(project.productName || "Project").replace(/[^a-zA-Z0-9]+/g, "_")}.pptx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": PPTX_MIME_TYPE,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to download deck" }, { status: 500 });
  }
}
