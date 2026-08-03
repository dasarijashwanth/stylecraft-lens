import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listAllGuides, createNewVersion } from "@/lib/db/brand-voice-guides";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Every version of every brand — the admin page groups these client-side.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const guides = await listAllGuides();
    return NextResponse.json({ guides });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load brand voice guides" }, { status: err.status || 500 });
  }
}

// Saving an edit always creates a NEW version row (never mutates an
// existing one) — same "new row per edit, old ones stay queryable"
// precedent as deck_templates/gtm_workbook_templates. Does not activate it;
// the admin explicitly activates via .../[id]/activate.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const body = await req.json();
    if (!body.brand || typeof body.brand !== "string") {
      return NextResponse.json({ error: "brand is required" }, { status: 400 });
    }
    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    const guide = await createNewVersion({ brand: body.brand.trim(), content: body.content, createdBy: session.email });
    return NextResponse.json({ guide });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save brand voice guide" }, { status: err.status || 500 });
  }
}
