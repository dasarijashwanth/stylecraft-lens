import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listHeatTechFamilies } from "@/lib/db/heat-tech-families";

// Read-only, no admin gate — the analyze form needs this to populate the
// Heat/Plate Technology select for motorless styling tools (flat iron/
// curling iron/hot brush). Mirrors app/api/motor-families/route.ts exactly.
export async function GET() {
  try {
    await getAuthSession();
    const families = (await listHeatTechFamilies()).filter(f => f.enabled);
    return NextResponse.json({ families });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load heat/plate technology families" }, { status: err.status || 500 });
  }
}
