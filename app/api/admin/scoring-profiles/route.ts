import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { upsertScoringProfile, deleteScoringProfile } from "@/lib/db/scoring-profiles";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Upserts the weight profile for a tool type (typeKey: null = the global
// default row). Admin-gated — this is shared, global scoring config, not a
// per-org setting — same authorization level as motor-families/tool-types
// admin edits. The analyze/new-project forms' "Save to profile" action also
// calls this; a non-admin user clicking it gets a clear 403 toast.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { typeKey, motor, price, feature } = await req.json();
    if (typeof motor !== "number" || typeof price !== "number" || typeof feature !== "number") {
      return NextResponse.json({ error: "motor, price, and feature must all be numbers" }, { status: 400 });
    }

    const profile = await upsertScoringProfile(typeKey ?? null, { motor, price, feature });
    return NextResponse.json({ profile });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save scoring profile" }, { status: err.status || 500 });
  }
}

// "Reset to default" — deletes a type-specific override row so resolution
// falls back to the global default. typeKey is required (the global
// default row itself can never be reset/deleted).
export async function DELETE(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { typeKey } = await req.json();
    if (!typeKey) {
      return NextResponse.json({ error: "typeKey is required" }, { status: 400 });
    }

    await deleteScoringProfile(typeKey);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to reset scoring profile" }, { status: err.status || 500 });
  }
}
