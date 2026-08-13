import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { removeCompetitorSlot } from "@/lib/analysisEngine";
import { CompetitorRemoveSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

// Part 3 (Remove + Refill single slot) — drops a wrongly-selected
// competitor from its slot, replacing it in place with an honest "removed,
// awaiting refill" placeholder (lib/analysisEngine.ts's removeCompetitorSlot).
// Same auth/ownership/rate-limit shape as the existing
// app/api/analyses/[id]/competitors/replace/route.ts.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    const validation = CompetitorRemoveSchema.safeParse(body);
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

    const rateLimit = await checkRateLimit({ eventType: "competitor_remove", userId: session.userId, maxAttempts: 30, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many competitor removals — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }
    // Per-analysis burst guard — removeCompetitorSlot does a read-modify-
    // write over the whole phase-result column (patchAnalysisPhaseResults),
    // same exposure app/api/analyses/[id]/continue/route.ts's own burst
    // guard protects against: two mutations against the SAME analysis
    // landing close together (two card actions in quick succession, two
    // open tabs) could otherwise silently drop one edit.
    const burstGuard = await checkRateLimit({ eventType: "competitor_remove", userId: `${session.userId}:${params.id}`, maxAttempts: 1, windowMinutes: 0.05 });
    if (burstGuard.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Another change to this analysis is still in progress — please wait a moment and try again." }, { status: 429 });
    }

    const { asin, reason, note } = validation.data;
    const result = await removeCompetitorSlot(params.id, asin, session.userId, { reason, note });
    return NextResponse.json(result);
  } catch (error: any) {
    // removeCompetitorSlot throws plain Errors for hard-block cases
    // (missing identity, no matching ASIN) — surfaced as a 404/400-shaped
    // response rather than a generic 500 so the client can show the real
    // reason.
    const message = error.message || "Failed to remove competitor";
    const isNotFound = /No competitor with ASIN|Analysis has no confirmed product identity/i.test(message);
    return NextResponse.json(
      { error: isNotFound ? "NOT_FOUND" : "SERVER_ERROR", message },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
