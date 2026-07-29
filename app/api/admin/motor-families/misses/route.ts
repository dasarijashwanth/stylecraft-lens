import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getMotorTechMisses } from "@/lib/db/motor-families";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Surfaces free-text Motor Technology entries (analyze/new-project forms)
// that didn't match any taxonomy family — see lib/motor-extraction.ts's
// resolveOurMotorType, which logs them. Read-only.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const misses = await getMotorTechMisses();
    return NextResponse.json({ misses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load motor tech search misses" }, { status: err.status || 500 });
  }
}
