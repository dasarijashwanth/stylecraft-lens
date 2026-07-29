import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listBrandedMotorNames, addBrandedMotorName } from "@/lib/db/branded-motor-names";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const brandedNames = await listBrandedMotorNames();
    return NextResponse.json({ brandedNames });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load branded motor names" }, { status: err.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { brandName, brandedTerm, familyKey } = await req.json();
    if (!brandName || !brandedTerm || !familyKey) {
      return NextResponse.json({ error: "brandName, brandedTerm, and familyKey are required" }, { status: 400 });
    }

    const entry = await addBrandedMotorName({
      brandName: String(brandName).trim(),
      brandedTerm: String(brandedTerm).trim(),
      familyKey: String(familyKey).trim(),
    });
    return NextResponse.json({ entry });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add branded motor name" }, { status: err.status || 500 });
  }
}
