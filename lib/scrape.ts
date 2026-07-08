// Best-effort, server-side product-page scraping — fetch() + cheerio, no
// headless browser. Vercel Hobby's fixed 60s timeout and unconfigurable
// memory make bundling a headless Chromium unreliable (cold start alone
// can eat 10-30s+), so this only ever sees server-rendered HTML. Heavily
// JS-hydrated storefronts will yield a sparse result — that's an accepted
// tradeoff (Amazon via lib/rainforest.ts is the primary reliable source);
// this never throws and never estimates missing data.
import * as cheerio from "cheerio";

export interface ScrapedProduct {
  title?: string;
  description?: string;
  brand?: string;
  price?: string;
  image?: string;
  raw: {
    jsonLd?: any;
    ogTags?: Record<string, string>;
    bodyTextSample?: string;
  };
}

const FETCH_TIMEOUT_MS = 8000;
// Honest and identifying, not a spoofed browser UA — accept a higher N/A
// rate on bot-protected sites rather than try to evade blocking.
const USER_AGENT = "StylecraftLensBot/1.0 (+https://stylecraft-lens.vercel.app; product data capture for internal TDS generation)";

function extractJsonLdProduct($: cheerio.CheerioAPI): any | null {
  let product: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (product) return;
    try {
      const parsed = JSON.parse($(el).contents().text());
      const candidates = Array.isArray(parsed) ? parsed : (parsed["@graph"] ? parsed["@graph"] : [parsed]);
      const found = candidates.find((c: any) => c && (c["@type"] === "Product" || (Array.isArray(c["@type"]) && c["@type"].includes("Product"))));
      if (found) product = found;
    } catch {
      // malformed JSON-LD block — skip it, try the next one
    }
  });
  return product;
}

export async function scrapeProductPage(url: string): Promise<ScrapedProduct | null> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = cheerio.load(html);
  const result: ScrapedProduct = { raw: {} };

  // 1. JSON-LD Product schema first — many SSR e-commerce platforms
  // (Shopify, WooCommerce, BigCommerce) emit this even when the visible
  // DOM is otherwise client-hydrated.
  const jsonLd = extractJsonLdProduct($);
  if (jsonLd) {
    result.raw.jsonLd = jsonLd;
    result.title = jsonLd.name;
    result.description = jsonLd.description;
    result.brand = typeof jsonLd.brand === "string" ? jsonLd.brand : jsonLd.brand?.name;
    const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offer?.price) result.price = `${offer.priceCurrency === "USD" || !offer.priceCurrency ? "$" : offer.priceCurrency}${offer.price}`;
    result.image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
  }

  // 2. OpenGraph / meta tags fill whatever JSON-LD didn't provide.
  const og = (prop: string) => $(`meta[property="og:${prop}"]`).attr("content");
  result.raw.ogTags = {
    title: og("title") || "",
    description: og("description") || "",
    image: og("image") || "",
  };
  result.title = result.title || og("title") || $("title").first().text().trim() || undefined;
  result.description = result.description || og("description") || $('meta[name="description"]').attr("content") || undefined;
  result.image = result.image || og("image") || undefined;

  // 3. Price regex as a last resort.
  if (!result.price) {
    const bodyText = $("body").text();
    const match = bodyText.match(/\$\s?\d[\d,]*(\.\d{2})?/);
    if (match) result.price = match[0].replace(/\s+/g, "");
  }

  // Fallback grounding text — lets verifyGrounding substring-check a spec
  // value even when structured extraction above missed it.
  result.raw.bodyTextSample = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);

  return result;
}
