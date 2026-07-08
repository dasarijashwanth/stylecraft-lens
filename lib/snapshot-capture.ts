// Orchestrates a single product-snapshot capture: real Amazon data (via the
// existing Rainforest integration) and a best-effort official-site scrape,
// run in parallel — this is the one part of the whole pipeline most exposed
// to Vercel Hobby's fixed 60s cap, so the two independent I/O calls MUST
// run concurrently, not sequentially.
import { getAmazonProduct } from "./rainforest";
import { scrapeProductPage } from "./scrape";
import { insertSnapshot, SnapshotRow } from "./db/snapshots";

export interface SnapshotProjection {
  title?: string;
  brand?: string;
  price?: string;
  image?: string;
  description?: string;
}

export interface CaptureResult {
  snapshot: SnapshotRow;
  projection: SnapshotProjection;
}

// Only ever resolves an ASIN when the user supplied one directly, or the
// product URL is itself an amazon.com/.../dp/<ASIN>/ link — deliberately
// never an automatic title-similarity guess. That lower-confidence path
// (lib/rainforest.ts's resolveAsinBySearch) exists for competitor
// discovery, not for identifying THE primary product itself.
function extractAsinFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

export async function captureProductSnapshot(input: {
  projectId: string;
  productUrl?: string | null;
  asin?: string | null;
}): Promise<CaptureResult> {
  const resolvedAsin = input.asin?.trim().toUpperCase() || extractAsinFromUrl(input.productUrl);
  const isAmazonUrl = !!input.productUrl && /amazon\./i.test(input.productUrl);

  const [amazonProduct, scraped] = await Promise.all([
    resolvedAsin ? getAmazonProduct(resolvedAsin) : Promise.resolve(null),
    // Scraping an Amazon URL directly is redundant with the Rainforest
    // lookup above and far more likely to be bot-blocked — skip it.
    input.productUrl && !isAmazonUrl ? scrapeProductPage(input.productUrl) : Promise.resolve(null),
  ]);

  const rawData = {
    amazon: amazonProduct,
    site: scraped,
  };

  const projection: SnapshotProjection = {
    title: scraped?.title || amazonProduct?.title,
    brand: scraped?.brand,
    price: scraped?.price || amazonProduct?.price,
    image: scraped?.image || amazonProduct?.image || undefined,
    description: scraped?.description,
  };

  const snapshot = await insertSnapshot({
    projectId: input.projectId,
    sourceUrl: input.productUrl ?? null,
    asin: resolvedAsin,
    rawData,
  });

  return { snapshot, projection };
}
