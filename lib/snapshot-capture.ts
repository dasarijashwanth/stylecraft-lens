// Orchestrates a single product-snapshot capture: real Amazon data (via the
// existing Rainforest integration) and a best-effort official-site scrape,
// run in parallel — this is the one part of the whole pipeline most exposed
// to Vercel Hobby's fixed 60s cap, so the two independent I/O calls MUST
// run concurrently, not sequentially.
import { getAmazonProduct } from "./rainforest";
import { scrapeProductPage } from "./scrape";
import { insertSnapshot, SnapshotRow } from "./db/snapshots";
import { assertToolType, ToolType } from "./tool-type-taxonomy";

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
  // Strict tool-type isolation (lib/tool-type-taxonomy.ts) — the most
  // direct way TDS's own motor_type/blade_name/etc. fields could become
  // wrong-tool-type is a wrong ASIN/URL captured at this exact step, with
  // no prior verification that the captured product matches the project's
  // declared type. Optional/best-effort: absent for a project created
  // before this field existed, in which case nothing is checked (never a
  // guess at what "should" have been required).
  requiredToolType?: ToolType | null;
}): Promise<CaptureResult> {
  const resolvedAsin = input.asin?.trim().toUpperCase() || extractAsinFromUrl(input.productUrl);
  const isAmazonUrl = !!input.productUrl && /amazon\./i.test(input.productUrl);

  const [amazonProduct, scraped] = await Promise.all([
    resolvedAsin ? getAmazonProduct(resolvedAsin) : Promise.resolve(null),
    // Scraping an Amazon URL directly is redundant with the Rainforest
    // lookup above and far more likely to be bot-blocked — skip it.
    input.productUrl && !isAmazonUrl ? scrapeProductPage(input.productUrl) : Promise.resolve(null),
  ]);

  const projection: SnapshotProjection = {
    title: scraped?.title || amazonProduct?.title,
    // Amazon-sourced fallback lets a pure-ASIN project (no separate site
    // URL) still auto-fill a description/brand — zero extra cost, since
    // amazonProduct was already fetched above.
    brand: scraped?.brand || amazonProduct?.brand || undefined,
    price: scraped?.price || amazonProduct?.price,
    image: scraped?.image || amazonProduct?.image || undefined,
    description: scraped?.description || amazonProduct?.description || undefined,
  };

  // Never silently trusted — a wrong ASIN/URL (typo, hallucinated
  // suggestion, wrong sibling SKU) would otherwise become this project's
  // "verified" spec floor with no visibility into the mismatch. The
  // captured product/page isn't discarded (still the best data available,
  // and might just be an unrecognized-vocabulary title), only flagged for
  // a visible warning downstream.
  let toolTypeMismatch = false;
  let toolTypeMismatchReason: string | null = null;
  if (input.requiredToolType && (projection.title || projection.description)) {
    const check = assertToolType(`${projection.title || ""} ${projection.description || ""}`, input.requiredToolType);
    if (!check.ok) {
      toolTypeMismatch = true;
      toolTypeMismatchReason = `Captured product "${projection.title}" doesn't match this project's declared tool type (${input.requiredToolType}) — reason: ${check.reason}`;
      console.warn(`[tool-type] ${toolTypeMismatchReason}`);
    }
  }

  const rawData = {
    amazon: amazonProduct,
    site: scraped,
    toolTypeMismatch,
    toolTypeMismatchReason,
  };

  const snapshot = await insertSnapshot({
    projectId: input.projectId,
    sourceUrl: input.productUrl ?? null,
    asin: resolvedAsin,
    rawData,
  });

  return { snapshot, projection };
}
