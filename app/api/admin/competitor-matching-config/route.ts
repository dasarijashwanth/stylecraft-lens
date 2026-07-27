import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getMatchingWeights, updateMatchingWeights } from "@/lib/db/competitor-matching-config";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const weights = await getMatchingWeights();
    return NextResponse.json({ weights });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load matching weights" }, { status: err.status || 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { motor, price, feature } = await req.json();
    if (typeof motor !== "number" || typeof price !== "number" || typeof feature !== "number") {
      return NextResponse.json({ error: "motor, price, and feature must all be numbers" }, { status: 400 });
    }

    const weights = await updateMatchingWeights({ motor, price, feature });
    return NextResponse.json({ weights });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update matching weights" }, { status: err.status || 500 });
  }
}
