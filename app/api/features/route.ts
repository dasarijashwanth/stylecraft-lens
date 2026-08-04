import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isTdsEnabled, isBuyerSentimentEnabled, isNewsUpdatesEnabled, isDeckGenerationEnabled } from "@/lib/feature-flags";

// Read-only, no admin gate — every dashboard page needs this to decide
// whether to render TDS UI. Authenticated (not public) only because
// middleware.ts already 401s every unauthenticated /api/** request; this
// route has no per-org data of its own to further restrict.
export async function GET() {
  try {
    await getAuthSession();
    const [tds_enabled, buyer_sentiment_enabled, news_updates_enabled, deck_generation_enabled] = await Promise.all([
      isTdsEnabled(),
      isBuyerSentimentEnabled(),
      isNewsUpdatesEnabled(),
      isDeckGenerationEnabled(),
    ]);
    return NextResponse.json({ tds_enabled, buyer_sentiment_enabled, news_updates_enabled, deck_generation_enabled });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load feature flags" }, { status: err.status || 500 });
  }
}
