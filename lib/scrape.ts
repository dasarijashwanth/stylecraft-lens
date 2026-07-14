// Best-effort, server-side product-page scraping — fetch() + cheerio, no
// headless browser. Vercel Hobby's fixed 60s timeout and unconfigurable
// memory make bundling a headless Chromium unreliable (cold start alone
// can eat 10-30s+), so this only ever sees server-rendered HTML. Heavily
// JS-hydrated storefronts will yield a sparse result — that's an accepted
// tradeoff (Amazon via lib/rainforest.ts is the primary reliable source);
// this never throws and never estimates missing data.
import * as cheerio from "cheerio";
import { hasOpenAIKey, searchAndExtractJson } from "./openai";

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
  // Set when the plain fetch+cheerio result was sparse and OpenAI's
  // web_search tool filled the gaps by actually opening the page (or
  // finding it via search) — distinguishes AI-assisted fields from the
  // ones cheerio parsed directly out of the page's own markup.
  source?: "cheerio" | "cheerio+openai_search";
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

  // JSON-LD/meta extraction above needs <script> tags present; safe to
  // strip them (and other non-visible tags) now. Left in, cheerio's
  // .text() concatenates inline JS/CSS and — on template-driven storefronts
  // — literal Handlebars/Mustache markup living inside
  // <script type="text/x-...-template"> tags, which otherwise drowns out
  // real page text in both the price regex and bodyTextSample below.
  $("script, style, noscript, template, svg").remove();

  // 3. Price regex as a last resort — matches the FIRST dollar amount
  // anywhere in the page text, which is unreliable (confirmed in testing:
  // it matched "$99" out of a "FREE SHIPPING OVER $99" marketing banner on
  // a page with no actual product price). Kept as better-than-nothing raw
  // data, but flagged separately so callers (the sparse-data fallback
  // below) don't mistake it for a real, trustworthy price the way a
  // JSON-LD-sourced price is.
  let priceIsRegexGuess = false;
  if (!result.price) {
    const bodyText = $("body").text();
    const match = bodyText.match(/\$\s?\d[\d,]*(\.\d{2})?/);
    if (match) {
      result.price = match[0].replace(/\s+/g, "");
      priceIsRegexGuess = true;
    }
  }

  // Fallback grounding text — lets verifyGrounding substring-check a spec
  // value even when structured extraction above missed it.
  result.raw.bodyTextSample = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);
  result.source = "cheerio";

  // Heavily JS-hydrated storefronts leave cheerio with little/nothing to
  // parse (the historical limitation this file's header comment accepts as
  // a tradeoff). If the key fields are still missing and an OpenAI key is
  // configured, fall back to a real search+read agent instead of just
  // returning a sparse result — it opens the actual page (or finds it via
  // search if this URL didn't render) and only fills in what cheerio
  // missed, never overwriting data cheerio already found directly in the
  // page's own markup.
  const isSparse = !result.title || !result.price || priceIsRegexGuess;
  if (isSparse && hasOpenAIKey) {
    try {
      const { data } = await searchAndExtractJson<{
        title?: string; description?: string; brand?: string; price?: string;
      }>(
        `Extract this exact product's title, description, brand, and price from the given URL. Open the URL directly if you can; if it doesn't render useful content, search for the product and use the official/retailer listing you find instead. Use ONLY what you actually find — never guess or invent a price/spec. Return ONLY valid JSON: {"title": "...", "description": "...", "brand": "...", "price": "$XX.XX"} — omit any field you can't verify.`,
        `URL: ${url}`,
        20_000
      );
      if (data) {
        // A verified search-derived price replaces the regex guess (which
        // was never trustworthy) but never overwrites a JSON-LD price.
        result.title = result.title || data.title;
        result.description = result.description || data.description;
        result.brand = result.brand || data.brand;
        result.price = (!result.price || priceIsRegexGuess) ? (data.price || result.price) : result.price;
        result.source = "cheerio+openai_search";
      }
    } catch (err) {
      console.warn("OpenAI search fallback for scrapeProductPage failed:", err);
    }
  }

  return result;
}
