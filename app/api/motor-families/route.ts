import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listMotorFamilies } from "@/lib/db/motor-families";

// Read-only, no admin gate — the analyze/new-project forms need this to
// populate the Motor Technology <datalist> with real taxonomy labels/
// aliases. Authenticated (not public) only because middleware.ts already
// 401s every unauthenticated /api/** request; mirrors app/api/features/
// route.ts's exact shape.
export async function GET() {
  try {
    await getAuthSession();
    const families = (await listMotorFamilies()).filter(f => f.enabled);
    return NextResponse.json({ families });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load motor families" }, { status: err.status || 500 });
  }
}
