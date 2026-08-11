import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";
import { reorderGroomingGateRules } from "@/lib/db/grooming-gate-rules";

// body: { orderedIds: string[] } — rule ids in the new desired sort order.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "POST /api/admin/grooming-gate/reorder");

    const { orderedIds } = await req.json();
    if (!Array.isArray(orderedIds)) {
      return NextResponse.json({ error: "orderedIds must be an array" }, { status: 400 });
    }

    await reorderGroomingGateRules(orderedIds);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to reorder grooming gate rules" }, { status: err.status || 500 });
  }
}
