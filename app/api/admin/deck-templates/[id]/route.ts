import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getDeckTemplateById, updateDeckTemplatePlaceholderMap } from "@/lib/db/deck-templates";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const template = await getDeckTemplateById(params.id);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json({ template });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load deck template" }, { status: err.status || 500 });
  }
}

// Body: { placeholder_map: DeckPlaceholderMap } — how an admin resolves
// flagged-unmapped tokens and sets per-token max_length/notes.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    if (!body?.placeholder_map) {
      return NextResponse.json({ error: "placeholder_map is required" }, { status: 400 });
    }

    const template = await updateDeckTemplatePlaceholderMap(params.id, body.placeholder_map);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json({ template });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update deck template" }, { status: err.status || 500 });
  }
}
