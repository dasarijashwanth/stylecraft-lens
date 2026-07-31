import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { expireCorrection, reactivateCorrection } from "@/lib/db/competitor-corrections";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Toggles a correction's active/expired state — never deletes (PART 3's
// "learning must stay inspectable and reversible" requirement). Expiring
// stops it counting toward the blocklist/penalty/preference computation
// in lib/analysisEngine.ts; reactivating restores it.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const { action } = await request.json() as { action: "expire" | "reactivate" };
    if (action === "expire") {
      await expireCorrection(params.id);
    } else if (action === "reactivate") {
      await reactivateCorrection(params.id);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update correction" }, { status: err.status || 500 });
  }
}
