import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listToolTypes } from "@/lib/db/tool-types";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Admin-only, returns EVERY row (including disabled) so the admin panel can
// re-enable one — unlike the public GET /api/tool-types (used by the
// analyze/new-project forms), which filters to enabled-only.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const toolTypes = await listToolTypes();
    return NextResponse.json({ toolTypes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load tool types" }, { status: err.status || 500 });
  }
}
