import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateBrandNameHint, deleteBrandNameHint } from "@/lib/db/brand-name-hints";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Handles enable/disable, rename, and name-prefix edits — all via the same
// partial-patch shape as legacy-brands' brand PATCH route.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    const patch: { brand?: string; namePrefixes?: string[]; enabled?: boolean; sortOrder?: number } = {};
    if (typeof body.brand === "string") patch.brand = body.brand.trim();
    if (Array.isArray(body.namePrefixes)) patch.namePrefixes = body.namePrefixes.filter(Boolean);
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const hint = await updateBrandNameHint(params.id, patch);
    if (!hint) return NextResponse.json({ error: "Hint not found" }, { status: 404 });
    return NextResponse.json({ hint });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update brand name hint" }, { status: err.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    await deleteBrandNameHint(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete brand name hint" }, { status: err.status || 500 });
  }
}
