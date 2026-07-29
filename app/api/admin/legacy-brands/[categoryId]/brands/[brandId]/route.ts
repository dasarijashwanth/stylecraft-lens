import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateBrand, deleteBrand } from "@/lib/db/legacy-brands";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Handles enable/disable (Part 1's "disable — keeps it but skips in
// discovery" requirement), rename, and alias edits — all via the same
// partial-patch shape.
export async function PATCH(req: NextRequest, { params }: { params: { categoryId: string; brandId: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    const patch: { brandName?: string; aliases?: string[]; officialDomains?: string[]; enabled?: boolean; sortOrder?: number } = {};
    if (typeof body.brandName === "string") patch.brandName = body.brandName.trim();
    if (Array.isArray(body.aliases)) patch.aliases = body.aliases.filter(Boolean);
    if (Array.isArray(body.officialDomains)) patch.officialDomains = body.officialDomains.filter(Boolean);
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const brand = await updateBrand(params.brandId, patch);
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ brand });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update brand" }, { status: err.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { categoryId: string; brandId: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    await deleteBrand(params.brandId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete brand" }, { status: err.status || 500 });
  }
}
