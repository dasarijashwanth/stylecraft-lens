// Shared cache-key resolution for the per-product resolver routes
// (reviews-analysis, product-news, key-features). A product with no
// Amazon presence at all has no valid ASIN — these routes must still work
// for it (that's the whole point of the multi-source fallback), so the
// path param accepts the literal "none" and this derives a stable,
// deterministic cache key from the product name instead.
// amazon_cache.asin is VARCHAR(20) — a truncated product-name slug would
// either overflow that or collide too easily, so this uses a short
// deterministic hash (djb2) instead. Same product name always maps to the
// same cache row; a hash collision between two differently-named products
// would only cross-contaminate a cache entry (low severity, not a
// correctness/security issue), never affect real ASIN-keyed entries.
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function resolveCacheKey(asinParam: string, productName: string): string {
  const asin = (asinParam || "").toUpperCase();
  if (/^[A-Z0-9]{10}$/.test(asin)) return asin;

  return `NA${djb2(productName.toLowerCase().trim())}`.slice(0, 20);
}
