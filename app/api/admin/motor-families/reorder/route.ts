import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { reorderMotorFamilies } from "@/lib/db/motor-families";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// body: { orderedIds: string[] } — family ids in the new desired priority order.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { orderedIds } = await req.json();
    if (!Array.isArray(orderedIds)) {
      return NextResponse.json({ error: "orderedIds must be an array" }, { status: 400 });
    }

    await reorderMotorFamilies(orderedIds);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to reorder motor families" }, { status: err.status || 500 });
  }
}
