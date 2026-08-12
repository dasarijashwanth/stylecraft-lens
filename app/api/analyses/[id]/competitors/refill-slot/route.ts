import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { refillCompetitorSlot } from "@/lib/analysisEngine";
import { CompetitorRefillSlotSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

// Part 3 (Remove + Refill single slot) — searches for a replacement for a
// slot previously vacated by /competitors/remove (lib/analysisEngine.ts's
// refillCompetitorSlot). An honest "nothing qualifies" (result.ok === false)
// is a NORMAL outcome here, always returned as HTTP 200 — matching this
// codebase's existing empty-slot "explicit empty is not a failure"
// convention — not an error response. Only a structural problem (analysis
// not found, no such removed slot) is a real error.
//
// refillCompetitorSlot's Tier B can invoke a real, multi-search-term live
// Rainforest lookup (discoverCompetitorsLive) — see
// app/api/analyses/[id]/competitors/preview/route.ts's fuller comment on
// why this needs a longer-than-default function duration.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    const validation = CompetitorRefillSlotSchema.safeParse(body);
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

    const rateLimit = await checkRateLimit({ eventType: "competitor_refill_slot", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many refill attempts — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

    const { removedAsin } = validation.data;
    const result = await refillCompetitorSlot(params.id, removedAsin, session.userId);
    return NextResponse.json(result);
  } catch (error: any) {
    const message = error.message || "Failed to refill competitor slot";
    const isNotFound = /No removed slot with ASIN|Analysis has no confirmed product identity/i.test(message);
    return NextResponse.json(
      { error: isNotFound ? "NOT_FOUND" : "SERVER_ERROR", message },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
