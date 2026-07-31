import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listAllCorrections } from "@/lib/db/competitor-corrections";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Every correction ever recorded (lib/analysisEngine.ts's replaceCompetitor),
// including expired ones — inspectability is the whole point of the
// expired_at soft-disable (never a hard delete). Read-only.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const corrections = await listAllCorrections();
    return NextResponse.json({ corrections });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load competitor corrections" }, { status: err.status || 500 });
  }
}
