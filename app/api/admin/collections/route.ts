import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listAllCollections, addCollection } from "@/lib/db/collections";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// All rows (enabled + disabled), for the admin Settings page.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const collections = await listAllCollections();
    return NextResponse.json({ collections });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load collections" }, { status: err.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const body = await req.json();
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const collection = await addCollection({
      name: body.name.trim(),
      narrativeKernel: typeof body.narrativeKernel === "string" ? body.narrativeKernel : "",
      logoMeaning: typeof body.logoMeaning === "string" ? body.logoMeaning : "",
      voiceNotes: typeof body.voiceNotes === "string" ? body.voiceNotes : "",
    });
    return NextResponse.json({ collection });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add collection" }, { status: err.status || 500 });
  }
}
