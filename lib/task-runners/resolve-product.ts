// getAmazonProduct (lib/rainforest.ts) already caches internally
// (withSupabaseCache, 12h TTL) — this thin wrapper exists only so the
// Inngest phase4 "fetch_product_data" task and the manual-refresh route
// (app/api/amazon/product/[asin]/route.ts) call the exact same entry
// point, matching the pattern used for the other three task-runners.
import { getAmazonProduct } from "@/lib/rainforest";

export async function resolveProduct(asin: string) {
  return getAmazonProduct(asin);
}
