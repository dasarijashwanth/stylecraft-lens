import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { recordFaqVote, listAllFaqsForAdmin } from "@/lib/db/faqs";
import { checkRateLimit } from "@/lib/rate-limit";

// Anonymous per-vote logging (Part 1's 👍/👎) — one row per vote, not an
// aggregate counter, matching this app's general event-log preference.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();

    // Security audit fix — spam guard (no ownership dimension exists here;
    // just bounds one account skewing admin-visible vote analytics).
    const rateLimit = await checkRateLimit({ eventType: "faq_vote", userId: session.userId, maxAttempts: 60, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many votes — please slow down." }, { status: 429 });
    }

    const { vote } = await req.json();
    if (vote !== "up" && vote !== "down") {
      return NextResponse.json({ error: "vote must be 'up' or 'down'" }, { status: 400 });
    }

    // Security audit fix — confirm the id refers to a real FAQ before
    // inserting a vote row for it (checked against the full admin set, not
    // just enabled/feature-gated ones, since this is purely an existence
    // check).
    const faqs = await listAllFaqsForAdmin();
    if (!faqs.some(f => f.id === params.id)) return NextResponse.json({ error: "FAQ not found" }, { status: 404 });

    await recordFaqVote(params.id, vote);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to record vote" }, { status: err.status || 500 });
  }
}
