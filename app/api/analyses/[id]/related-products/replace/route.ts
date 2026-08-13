import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { replaceRelatedProduct } from "@/lib/analysisEngine";
import { RelatedProductReplaceSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

// "Fixing a mispaste re-fetches in place" (Related Products, Part 3.5) —
// deliberately simpler than app/api/analyses/[id]/competitors/replace's
// route: no correction reason, no learning-loop record (see
// lib/analysisEngine.ts's replaceRelatedProduct header comment). Same
// auth/ownership pattern as every other analysis-scoped route here.
//
// See app/api/analyses/[id]/competitors/preview/route.ts's fuller comment —
// the underlying Rainforest lookup this triggers can legitimately take well
// over Vercel's default function duration for some listings.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    const validation = RelatedProductReplaceSchema.safeParse(body);
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

    // Broad-audit finding — this route had no rate limit at all despite
    // forcing a real Rainforest lookup, unlike its sibling
    // competitors/replace (30/hr). Same 30/hr cap, plus the same
    // per-analysis burst guard the sibling single-slot mutation routes
    // all now have (replaceRelatedProduct/patchRelatedProducts is the same
    // read-modify-write-whole-column shape).
    const rateLimit = await checkRateLimit({ eventType: "related_product_replace", userId: session.userId, maxAttempts: 30, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many related-product replacements — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }
    const burstGuard = await checkRateLimit({ eventType: "related_product_replace", userId: `${session.userId}:${params.id}`, maxAttempts: 1, windowMinutes: 0.05 });
    if (burstGuard.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Another change to this analysis is still in progress — please wait a moment and try again." }, { status: 429 });
    }

    const { oldAsin, asinOrUrl } = validation.data;
    const result = await replaceRelatedProduct(params.id, oldAsin, asinOrUrl);
    return NextResponse.json({ relatedProduct: result.relatedProduct });
  } catch (error: any) {
    const message = error.message || "Failed to replace related product";
    const isNotFound = /No related product with ASIN|Could not fetch a real Amazon product|Could not resolve an ASIN/i.test(message);
    return NextResponse.json(
      { error: isNotFound ? "NOT_FOUND" : "SERVER_ERROR", message },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
