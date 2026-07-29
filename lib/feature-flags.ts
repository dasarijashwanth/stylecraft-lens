// lib/feature-flags.ts
// One named function per flag (not a generic string-keyed getter at every
// call site) — keeps every call site self-documenting and type-checked.
// Add the next one the same way if a second flag ever appears.
import { getFeatureFlag } from "./db/feature-flags";

export async function isTdsEnabled(): Promise<boolean> {
  return getFeatureFlag("tds_enabled");
}

export async function isBuyerSentimentEnabled(): Promise<boolean> {
  return getFeatureFlag("buyer_sentiment_enabled");
}

export async function isNewsUpdatesEnabled(): Promise<boolean> {
  return getFeatureFlag("news_updates_enabled");
}
