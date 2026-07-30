import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateToolType, deleteToolType } from "@/lib/db/tool-types";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Handles enable/disable ("promote" a custom type to permanently visible is
// just enabled:true, which it already is by default — this mainly covers
// disable/merge-by-disabling and rename/alias edits), same partial-patch
// shape as the motor-families admin route.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    const patch: { label?: string; aliases?: string[]; family?: string | null; enabled?: boolean; sortOrder?: number } = {};
    if (typeof body.label === "string") patch.label = body.label.trim();
    if (Array.isArray(body.aliases)) patch.aliases = body.aliases.filter(Boolean);
    if (body.family === "clipper_trimmer_shaver" || body.family === "beauty" || body.family === null) patch.family = body.family;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const toolType = await updateToolType(params.id, patch);
    if (!toolType) return NextResponse.json({ error: "Tool type not found" }, { status: 404 });
    return NextResponse.json({ toolType });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update tool type" }, { status: err.status || 500 });
  }
}

// Merging is done as: PATCH the type to keep with the union of both
// aliases, then DELETE the redundant one — no dedicated "merge" endpoint
// needed. Same reasoning as motor-families' admin route (disable via
// PATCH is preferred over delete for built-ins with history; DELETE here
// is mainly for cleaning up a custom type added by mistake).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    await deleteToolType(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete tool type" }, { status: err.status || 500 });
  }
}
