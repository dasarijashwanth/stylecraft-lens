import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";
import { listFeatureFlags, setFeatureFlag } from "@/lib/db/feature-flags";

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "GET /api/admin/features");
    const flags = await listFeatureFlags();
    return NextResponse.json({ flags });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load feature flags" }, { status: err.status || 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "PATCH /api/admin/features");

    const { flagName, enabled } = await req.json();
    if (typeof flagName !== "string" || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "flagName (string) and enabled (boolean) are required" }, { status: 400 });
    }

    await setFeatureFlag(flagName, enabled);
    const flags = await listFeatureFlags();
    return NextResponse.json({ flags });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update feature flag" }, { status: err.status || 500 });
  }
}
