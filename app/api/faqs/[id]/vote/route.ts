import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { recordFaqVote } from "@/lib/db/faqs";

// Anonymous per-vote logging (Part 1's 👍/👎) — one row per vote, not an
// aggregate counter, matching this app's general event-log preference.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getAuthSession();

    const { vote } = await req.json();
    if (vote !== "up" && vote !== "down") {
      return NextResponse.json({ error: "vote must be 'up' or 'down'" }, { status: 400 });
    }

    await recordFaqVote(params.id, vote);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to record vote" }, { status: err.status || 500 });
  }
}
