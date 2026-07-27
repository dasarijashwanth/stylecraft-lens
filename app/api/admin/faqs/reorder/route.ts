import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { reorderFaqs } from "@/lib/db/faqs";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// body: { category: string, orderedIds: string[] } — FAQ ids within ONE
// category, in the new desired priority order (matches the per-category
// sort_order scoping already used by lib/db/faqs.ts's reorderFaqs).
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { category, orderedIds } = await req.json();
    if (!category || !Array.isArray(orderedIds)) {
      return NextResponse.json({ error: "category and orderedIds (array) are required" }, { status: 400 });
    }

    await reorderFaqs(category, orderedIds);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to reorder FAQs" }, { status: err.status || 500 });
  }
}
