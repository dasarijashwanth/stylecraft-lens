import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { logFaqSearchMiss } from "@/lib/db/faqs";

// Logs a zero-result FAQ search term (Part 3) so admins can see where the
// help content is missing coverage — see /api/admin/faqs/analytics.
export async function POST(req: NextRequest) {
  try {
    await getAuthSession();

    const { term } = await req.json();
    if (typeof term !== "string" || !term.trim()) {
      return NextResponse.json({ error: "term is required" }, { status: 400 });
    }

    await logFaqSearchMiss(term);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to log search miss" }, { status: err.status || 500 });
  }
}
