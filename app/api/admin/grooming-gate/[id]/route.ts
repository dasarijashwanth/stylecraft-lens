import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";
import { updateGroomingGateRule, deleteGroomingGateRule } from "@/lib/db/grooming-gate-rules";

// Handles enable/disable, value/label edits, and sort_order patches — same
// partial-patch shape as the motor-families admin route.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "PATCH /api/admin/grooming-gate/[id]");

    const body = await req.json();
    const patch: { value?: string; label?: string | null; enabled?: boolean; sortOrder?: number } = {};
    if (typeof body.value === "string") patch.value = body.value.trim();
    if (typeof body.label === "string" || body.label === null) patch.label = body.label === null ? null : body.label.trim();
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const rule = await updateGroomingGateRule(params.id, patch);
    if (!rule) return NextResponse.json({ error: "Grooming gate rule not found" }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update grooming gate rule" }, { status: err.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "DELETE /api/admin/grooming-gate/[id]");

    await deleteGroomingGateRule(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete grooming gate rule" }, { status: err.status || 500 });
  }
}
