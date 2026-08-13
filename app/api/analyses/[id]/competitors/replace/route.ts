import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { replaceCompetitor, resolveAsinFromInput } from "@/lib/analysisEngine";
import { CompetitorReplaceSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

// Executes a confirmed ASIN swap: forced-fresh Rainforest refetch, in-place
// rebuild of exactly this competitor (lib/analysisEngine.ts's
// replaceCompetitor — never re-ranks against siblings), records WHY via
// competitor_corrections. Same auth/ownership pattern as
// app/api/analyses/[id]/answer/route.ts.
//
// fetchAmazonProductFresh's real request/retry cycle can take well over
// Vercel's default function duration for some listings (see the fuller
// explanation on the sibling preview/route.ts) — without this, the request
// gets killed by the platform before ever returning a real error.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    const validation = CompetitorReplaceSchema.safeParse(body);
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

    // Security audit fix — forces a fresh Rainforest refetch (real API
    // cost) and writes a competitor_corrections row every call; that table
    // is a cross-org shared signal (see lib/analysisEngine.ts's
    // buildCorrectionSignals fix), so this also bounds how fast one
    // account can contribute correction volume even after the
    // distinct-user-count fix closes the single-account hard-block path.
    const rateLimit = await checkRateLimit({ eventType: "competitor_replace", userId: session.userId, maxAttempts: 30, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many competitor replacements — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }
    // Per-analysis burst guard, same mechanism/reasoning as
    // app/api/analyses/[id]/continue/route.ts's own — replaceCompetitor
    // does a read-the-whole-phase-result / mutate-in-memory / write-the-
    // whole-column-back cycle (patchAnalysisPhaseResults is a plain column
    // overwrite, not a DB-level merge). Two mutations against the SAME
    // analysis (e.g. two competitor cards' actions clicked in quick
    // succession, or two open tabs) racing this window could otherwise
    // silently drop one edit — this serializes them instead of letting
    // that happen silently.
    const burstGuard = await checkRateLimit({ eventType: "competitor_replace", userId: `${session.userId}:${params.id}`, maxAttempts: 1, windowMinutes: 0.05 });
    if (burstGuard.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Another change to this analysis is still in progress — please wait a moment and try again." }, { status: 429 });
    }

    const { oldAsin, asinOrUrl, reason, note } = validation.data;
    const newAsin = resolveAsinFromInput(asinOrUrl);
    if (!newAsin) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Enter a valid ASIN (10 letters/digits) or an Amazon product URL" }, { status: 400 });
    }

    const result = await replaceCompetitor(params.id, oldAsin, newAsin, session.userId, { reason, note });
    return NextResponse.json({ competitor: result.competitor, synthesisPossiblyStale: result.synthesisPossiblyStale });
  } catch (error: any) {
    // replaceCompetitor throws plain Errors for the hard-block cases
    // (duplicate ASIN, unresolvable ASIN, missing identity) — surfaced as
    // a 409/400-shaped response rather than a generic 500 so the client
    // can show the real reason.
    const message = error.message || "Failed to replace competitor";
    const isConflict = /already one of this analysis/i.test(message);
    const isNotFound = /No competitor with ASIN|Could not fetch a real Amazon product/i.test(message);
    return NextResponse.json(
      { error: isConflict ? "DUPLICATE_ASIN" : isNotFound ? "NOT_FOUND" : "SERVER_ERROR", message },
      { status: isConflict ? 409 : isNotFound ? 404 : 500 }
    );
  }
}
