import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listScoringProfiles } from "@/lib/db/scoring-profiles";

// Read-only, no admin gate — mirrors app/api/motor-families/route.ts and
// app/api/tool-types/route.ts's exact shape: the analyze/new-project
// forms' "Adjust weights for this analysis" expander needs the full list
// to resolve the current tool type's profile (or the global default)
// client-side, the same way it already resolves toolTypesForIndustry.
// Authenticated (not public) only because middleware.ts already 401s every
// unauthenticated /api/** request.
export async function GET() {
  try {
    await getAuthSession();
    const profiles = await listScoringProfiles();
    return NextResponse.json({ profiles });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load scoring profiles" }, { status: err.status || 500 });
  }
}
