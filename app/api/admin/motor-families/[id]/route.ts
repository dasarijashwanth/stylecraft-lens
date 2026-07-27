import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateMotorFamily, deleteMotorFamily } from "@/lib/db/motor-families";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Handles enable/disable, rename, alias, and adjacency edits — same
// partial-patch shape as the legacy-brands admin route.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    const patch: { label?: string; aliases?: string[]; adjacentFamilies?: string[]; enabled?: boolean; sortOrder?: number } = {};
    if (typeof body.label === "string") patch.label = body.label.trim();
    if (Array.isArray(body.aliases)) patch.aliases = body.aliases.filter(Boolean);
    if (Array.isArray(body.adjacentFamilies)) patch.adjacentFamilies = body.adjacentFamilies.filter(Boolean);
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const family = await updateMotorFamily(params.id, patch);
    if (!family) return NextResponse.json({ error: "Motor family not found" }, { status: 404 });
    return NextResponse.json({ family });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update motor family" }, { status: err.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    await deleteMotorFamily(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete motor family" }, { status: err.status || 500 });
  }
}
