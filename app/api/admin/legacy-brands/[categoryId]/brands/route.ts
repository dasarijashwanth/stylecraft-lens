import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { addBrand } from "@/lib/db/legacy-brands";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { categoryId: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { brandName, aliases } = await req.json();
    if (!brandName || !String(brandName).trim()) {
      return NextResponse.json({ error: "brandName is required" }, { status: 400 });
    }

    const brand = await addBrand(params.categoryId, {
      brandName: String(brandName).trim(),
      aliases: Array.isArray(aliases) ? aliases.filter(Boolean) : [],
    });
    return NextResponse.json({ brand });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add brand" }, { status: err.status || 500 });
  }
}
