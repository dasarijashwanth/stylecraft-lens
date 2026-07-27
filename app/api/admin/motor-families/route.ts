import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listMotorFamilies, addMotorFamily } from "@/lib/db/motor-families";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const families = await listMotorFamilies();
    return NextResponse.json({ families });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load motor families" }, { status: err.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { familyKey, label, domain, aliases, modifier, adjacentFamilies } = await req.json();
    if (!familyKey || !label || !domain) {
      return NextResponse.json({ error: "familyKey, label, and domain are required" }, { status: 400 });
    }

    const family = await addMotorFamily({
      familyKey: String(familyKey).trim(),
      label: String(label).trim(),
      domain: String(domain).trim(),
      aliases: Array.isArray(aliases) ? aliases.filter(Boolean) : [],
      modifier: !!modifier,
      adjacentFamilies: Array.isArray(adjacentFamilies) ? adjacentFamilies.filter(Boolean) : [],
    });
    return NextResponse.json({ family });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add motor family" }, { status: err.status || 500 });
  }
}
