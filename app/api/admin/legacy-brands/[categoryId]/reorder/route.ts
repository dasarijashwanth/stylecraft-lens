import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { reorderBrands } from "@/lib/db/legacy-brands";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// body: { orderedIds: string[] } — brand ids in the new desired priority
// order (index becomes the new sort_order, i.e. search priority).
export async function POST(req: NextRequest, { params }: { params: { categoryId: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { orderedIds } = await req.json();
    if (!Array.isArray(orderedIds)) {
      return NextResponse.json({ error: "orderedIds must be an array" }, { status: 400 });
    }

    await reorderBrands(params.categoryId, orderedIds);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to reorder brands" }, { status: err.status || 500 });
  }
}
