import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";
import { getGroomingGateIncidents, dismissGroomingGateIncident } from "@/lib/db/grooming-gate-rules";

// Surfaces the grooming/beauty industry gate's rejection audit log — logged
// from lib/analysisEngine.ts's post-selection sweep (phase1/phase2) and from
// a human's manual "wrong industry" Remove (manual_removal). Read-only list.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "GET /api/admin/grooming-gate/incidents");
    const incidents = await getGroomingGateIncidents();
    return NextResponse.json({ incidents });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load grooming gate incidents" }, { status: err.status || 500 });
  }
}

// Dismisses a reviewed incident once an admin has either added a rule to
// cover it or decided it's not worth acting on.
export async function DELETE(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "DELETE /api/admin/grooming-gate/incidents");

    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await dismissGroomingGateIncident(String(id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to dismiss grooming gate incident" }, { status: err.status || 500 });
  }
}
