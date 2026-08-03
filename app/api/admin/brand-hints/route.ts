import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listAllBrandNameHints, addBrandNameHint } from "@/lib/db/brand-name-hints";

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
    const hints = await listAllBrandNameHints();
    return NextResponse.json({ hints });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load brand name hints" }, { status: err.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const body = await req.json();
    if (!body.brand || typeof body.brand !== "string") {
      return NextResponse.json({ error: "brand is required" }, { status: 400 });
    }
    const hint = await addBrandNameHint({
      brand: body.brand.trim(),
      namePrefixes: Array.isArray(body.namePrefixes) ? body.namePrefixes.filter(Boolean) : [],
    });
    return NextResponse.json({ hint });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add brand name hint" }, { status: err.status || 500 });
  }
}
