import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateCollection, deleteCollection } from "@/lib/db/collections";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Handles enable/disable, rename, and kernel/logo/voice text edits — all via
// the same partial-patch shape as brand-hints' PATCH route.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    const patch: { name?: string; narrativeKernel?: string; logoMeaning?: string; voiceNotes?: string; enabled?: boolean; sortOrder?: number } = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.narrativeKernel === "string") patch.narrativeKernel = body.narrativeKernel;
    if (typeof body.logoMeaning === "string") patch.logoMeaning = body.logoMeaning;
    if (typeof body.voiceNotes === "string") patch.voiceNotes = body.voiceNotes;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const collection = await updateCollection(params.id, patch);
    if (!collection) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    return NextResponse.json({ collection });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update collection" }, { status: err.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    await deleteCollection(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete collection" }, { status: err.status || 500 });
  }
}
