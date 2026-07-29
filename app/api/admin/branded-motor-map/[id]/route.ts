import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateBrandedMotorName, deleteBrandedMotorName } from "@/lib/db/branded-motor-names";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    const patch: { brandName?: string; brandedTerm?: string; familyKey?: string; enabled?: boolean } = {};
    if (typeof body.brandName === "string") patch.brandName = body.brandName.trim();
    if (typeof body.brandedTerm === "string") patch.brandedTerm = body.brandedTerm.trim();
    if (typeof body.familyKey === "string") patch.familyKey = body.familyKey.trim();
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    const entry = await updateBrandedMotorName(params.id, patch);
    if (!entry) return NextResponse.json({ error: "Branded motor name not found" }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update branded motor name" }, { status: err.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    await deleteBrandedMotorName(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete branded motor name" }, { status: err.status || 500 });
  }
}
