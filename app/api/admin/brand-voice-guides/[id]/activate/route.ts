import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getGuideById, activateVersion } from "@/lib/db/brand-voice-guides";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const existing = await getGuideById(params.id);
    if (!existing) return NextResponse.json({ error: "Guide version not found" }, { status: 404 });

    await activateVersion(params.id);
    const updated = await getGuideById(params.id);
    return NextResponse.json({ guide: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to activate brand voice guide" }, { status: err.status || 500 });
  }
}
