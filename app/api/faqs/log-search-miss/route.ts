import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { logFaqSearchMiss } from "@/lib/db/faqs";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_TERM_LENGTH = 200;

// Logs a zero-result FAQ search term (Part 3) so admins can see where the
// help content is missing coverage — see /api/admin/faqs/analytics.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();

    // Security audit fix — spam guard on an unbounded, unvalidated free-text
    // insert (bounds one account flooding the admin-visible miss list).
    const rateLimit = await checkRateLimit({ eventType: "faq_search_miss", userId: session.userId, maxAttempts: 60, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many search-miss reports — please slow down." }, { status: 429 });
    }

    const { term } = await req.json();
    if (typeof term !== "string" || !term.trim() || term.length > MAX_TERM_LENGTH) {
      return NextResponse.json({ error: "term is required and must be under 200 characters" }, { status: 400 });
    }

    await logFaqSearchMiss(term);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to log search miss" }, { status: err.status || 500 });
  }
}
