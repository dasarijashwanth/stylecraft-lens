import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { removeCompetitorSlot, refillCompetitorSlot, mapWithConcurrency } from "@/lib/analysisEngine";
import { CompetitorBulkRefillSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

// Part 3 (Remove + Refill single slot) — bulk "Remove & refill N flagged"
// action: each item is a Remove immediately followed by a Refill of the
// same slot. Deliberately processed with concurrency 1 (sequential), NOT
// the file's usual mapWithConcurrency(items, 5, fn) fan-out pattern used
// for independent Rainforest lookups elsewhere — removeCompetitorSlot/
// refillCompetitorSlot both do a read-the-whole-analysis-row / mutate /
// write-the-whole-row-back cycle via patchAnalysisPhaseResults (a plain
// column overwrite, not a DB-level JSONB merge — confirmed by reading
// lib/db/analyses.ts). Two items landing in the same phase's competitors
// array concurrently would race and silently lose one of the writes, which
// a max-10-item bulk action can easily trigger (e.g. flagging 3 legacy +
// 2 emerging picks at once). Still bounded/cheap: at most 10 items, each a
// small in-process operation plus (at most) one live catalog search.
//
// maxDuration=60 is Vercel Hobby's actual ceiling (see CLAUDE.md) — a
// pathological worst case (10 items, every single one falling through to a
// slow Tier B live search) could still exceed it; that's an accepted edge
// case, not something a longer duration could fix on this plan anyway. The
// common case (most refills hit the instant Tier A runner-up pool) is
// nowhere near this limit.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    const validation = CompetitorBulkRefillSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() }, { status: 400 });
    }

    const existing = await getAnalysis(params.id);
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
    }
    if (existing.user_id !== session.userId) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Not your analysis" }, { status: 403 });
    }

    const rateLimit = await checkRateLimit({ eventType: "competitor_bulk_refill", userId: session.userId, maxAttempts: 10, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many bulk refill attempts — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const { items } = validation.data;
    const results = await mapWithConcurrency(items, 1, async (item) => {
      try {
        const removed = await removeCompetitorSlot(params.id, item.asin, session.userId, { reason: item.reason, note: item.note });
        const refilled = await refillCompetitorSlot(params.id, removed.removedAsin, session.userId);
        return { asin: item.asin, ok: true, removed, refilled };
      } catch (error: any) {
        return { asin: item.asin, ok: false, error: error.message || "Failed to remove/refill this competitor" };
      }
    });

    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message || "Failed bulk remove/refill" }, { status: 500 });
  }
}
