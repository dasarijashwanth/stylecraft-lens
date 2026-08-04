import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getMarketingDefaults, updateMarketingDefaults } from "@/lib/db/marketing-defaults";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const defaults = await getMarketingDefaults();
    return NextResponse.json({ defaults });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load marketing defaults" }, { status: err.status || 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const body = await req.json();
    if (typeof body.languages !== "string" || !body.languages.trim()) {
      return NextResponse.json({ error: "languages is required" }, { status: 400 });
    }
    const defaults = await updateMarketingDefaults(body.languages);
    return NextResponse.json({ defaults });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update marketing defaults" }, { status: err.status || 500 });
  }
}
