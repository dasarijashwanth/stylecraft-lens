// lib/indie-brand-lineup.ts
// Builds a real, Amazon-search-derived price lineup for an indie/emerging
// brand — the sole purpose is ranking where a specific candidate model
// sits within its own brand's line (Part 4's relative pricing), not
// discovery itself (that's still lib/analysisEngine.ts's Phase 2 flow).
// This is the one genuinely new, costly network operation this feature
// adds (confirmed with the user) — it gets its own hard time budget,
// mirroring lib/legacy-brand-discovery.ts's CURATED_BRAND_SEARCH_TIME_BUDGET_MS
// discipline exactly, since it runs inside Phase 2 alongside everything
// else already competing for Vercel's 60s ceiling.
import { searchAmazonCategory } from "./rainforest";

export const INDIE_LINEUP_TIME_BUDGET_MS = 8_000;

export interface LineupProduct {
  asin: string;
  title: string;
  price_raw: number;
}

// Duplicated deliberately rather than importing a shared version — matches
// this codebase's own explicit, stated precedent (lib/legacy-brand-discovery.ts's
// header comment) of keeping this ~10-line helper local to each file that
// needs it, avoiding a dependency back into lib/analysisEngine.ts.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function buildIndieBrandLineup(brandName: string, subcategory: string): Promise<LineupProduct[]> {
  const results = await searchAmazonCategory(`${brandName} ${subcategory}`.trim(), 8);
  return results
    .filter(r => r.price_raw != null && r.price_raw > 0)
    .map(r => ({ asin: r.asin, title: r.title, price_raw: r.price_raw as number }));
}

// Batch entry point — one lookup per distinct brand among the surviving
// Phase 2 candidates, concurrency-limited to 3 (matches
// lib/legacy-brand-discovery.ts's own concurrency choice). Once the shared
// time budget is exhausted, any brand not yet started is skipped entirely
// (empty lineup, never a partial/guessed one) — the caller falls back to
// absolute-band price scoring for those, never blocking Phase 2.
export async function buildIndieBrandLineups(brands: { brand: string; subcategory: string }[]): Promise<Map<string, LineupProduct[]>> {
  const startTime = Date.now();
  const result = new Map<string, LineupProduct[]>();

  await mapWithConcurrency(brands, 3, async ({ brand, subcategory }) => {
    if (Date.now() - startTime > INDIE_LINEUP_TIME_BUDGET_MS) {
      result.set(brand, []);
      return;
    }
    const lineup = await buildIndieBrandLineup(brand, subcategory);
    result.set(brand, lineup);
  });

  return result;
}

// Percentile of `price` within `lineup` (0 = cheapest, 1 = most expensive
// in the sample found). A single-item lineup has nothing to rank against —
// treated as its own full range (percentile 1) rather than an artificial
// midpoint, the only honest answer when there's nothing else to compare.
export function computePercentileInLineup(price: number, lineup: LineupProduct[]): number | null {
  const prices = lineup.map(p => p.price_raw).filter(p => p > 0);
  if (prices.length === 0) return null;
  if (prices.length === 1) return 1;

  const sorted = [...prices].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (price - min) / (max - min)));
}
