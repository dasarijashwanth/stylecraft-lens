import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getDeckTemplateById, setActiveDeckTemplate } from "@/lib/db/deck-templates";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const existing = await getDeckTemplateById(params.id);
    if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    await setActiveDeckTemplate(params.id);
    const updated = await getDeckTemplateById(params.id);
    return NextResponse.json({ template: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to activate deck template" }, { status: err.status || 500 });
  }
}
