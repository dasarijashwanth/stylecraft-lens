// lib/predecessor-product-context.ts
// "Based on an existing product" — a project can name (or link) a prior
// StyleCraft product it's a modified/refreshed version of, pasted on the
// analyze form next to Related Products. Resolved fresh on every GTM
// generation call (same "never cached across phases" discipline as
// lib/gtm-reference-links.ts/lib/gtm-uploaded-tds.ts) into a grounding text
// block used as a FALLBACK source — checked only for a field this
// project's own real sources (TDS, uploaded docs, reference links) can't
// answer, never allowed to override this product's own real, different
// specs. Three resolution tiers, richest first:
//   1. An existing project in this org with a matching product name AND a
//      real GTM document — reuses its actual confirmed field answers, the
//      richest possible grounding (this is genuinely the same/prior product
//      line, already fully documented in this same app).
//   2. A StyleCraft catalog product with a matching name — summary fields
//      only (no full GTM sheet exists for it), still real and structured.
//   3. An Amazon ASIN/URL, or any other product page URL — real external
//      data via Rainforest, or a lightweight page-title/text fetch.
import { resolveAsinLocal } from "./asin-parse-client";
import { getAmazonProduct } from "./rainforest";
import { fetchPageMeta } from "./citations";
import { getUserProjects } from "./db/projects";
import { getDocumentByProject, getDocumentFields, flattenDocumentFields } from "./db/documents";
import { listCatalogProducts } from "./db/catalog-products";
import { matchCatalogProductByName } from "./our-product-position";

export interface PredecessorProductContext {
  hasReference: boolean;
  // Human-readable name of whatever was resolved, for UI display — null
  // when nothing was found (a name/link that matched nothing real).
  label: string | null;
  // The grounding text block, already framed as a fallback-only source.
  // Null whenever hasReference is false.
  text: string | null;
}

const EMPTY: PredecessorProductContext = { hasReference: false, label: null, text: null };

function wrapFallbackBlock(label: string, body: string): string {
  return (
    `PREDECESSOR PRODUCT — "${label}" (an existing/prior product this one is based on or a modified version of). ` +
    `Use this ONLY as a last-resort fallback for a field you genuinely cannot determine from this project's own sources (TDS, uploaded docs, reference links) above — never let it override this product's own real, different specs, and never state it applies here without treating it as inherited/likely-similar rather than confirmed for THIS product:\n${body}`
  );
}

export async function getPredecessorProductContext(
  rawRef: string | null | undefined,
  orgId: string
): Promise<PredecessorProductContext> {
  const trimmed = (rawRef || "").trim();
  if (!trimmed) return EMPTY;

  const isUrl = /^https?:\/\//i.test(trimmed);

  if (!isUrl) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const target = norm(trimmed);

    // Tier 1: an existing project with a real GTM document.
    try {
      const projects = await getUserProjects(orgId);
      const matchedProject = (projects as any[]).find(p => {
        const a = norm(p.productName || "");
        const b = norm(p.name || "");
        return (a && (target === a || target.includes(a) || a.includes(target))) ||
               (b && (target === b || target.includes(b) || b.includes(target)));
      });
      if (matchedProject) {
        const doc = await getDocumentByProject(matchedProject.id, "gtm");
        if (doc) {
          const fields = await getDocumentFields(doc.id);
          const flat = flattenDocumentFields(fields);
          const entries = Object.entries(flat);
          if (entries.length > 0) {
            const body = entries.map(([k, v]) => `${k}: ${v}`).join("\n");
            const label = matchedProject.productName || matchedProject.name;
            return { hasReference: true, label, text: wrapFallbackBlock(label, body) };
          }
        }
      }
    } catch (e) {
      console.warn("Predecessor product project lookup failed:", e);
    }

    // Tier 2: a StyleCraft catalog product.
    try {
      const catalogProducts = await listCatalogProducts();
      const matched = matchCatalogProductByName(trimmed, catalogProducts);
      if (matched) {
        const parts = [
          matched.description ? `Description: ${matched.description}` : null,
          matched.target_price != null ? `Target price: $${matched.target_price.toFixed(2)}` : null,
          matched.motor_branded || matched.motor_family ? `Motor: ${matched.motor_branded || matched.motor_family}` : null,
          matched.heat_tech_branded || matched.heat_tech_family ? `Heat/Plate tech: ${matched.heat_tech_branded || matched.heat_tech_family}` : null,
          matched.sku ? `SKU: ${matched.sku}` : null,
        ].filter(Boolean);
        if (parts.length > 0) {
          return { hasReference: true, label: matched.name, text: wrapFallbackBlock(matched.name, parts.join("\n")) };
        }
      }
    } catch (e) {
      console.warn("Predecessor product catalog lookup failed:", e);
    }

    // A name was given but nothing matched — honest "found nothing",
    // never silently ignored (label still shown so the UI can say so).
    return { hasReference: false, label: trimmed, text: null };
  }

  // Tier 3a: an Amazon ASIN/URL — real structured product data.
  const asin = resolveAsinLocal(trimmed);
  if (asin) {
    try {
      const product = await getAmazonProduct(asin);
      if (product) {
        const parts = [
          product.brand ? `Brand: ${product.brand}` : null,
          product.price ? `Price: ${product.price}` : null,
          product.description ? `Description: ${product.description}` : null,
          product.feature_bullets?.length ? `Features: ${product.feature_bullets.join("; ")}` : null,
        ].filter(Boolean);
        return { hasReference: true, label: product.title, text: wrapFallbackBlock(product.title, parts.join("\n") || product.title) };
      }
    } catch (e) {
      console.warn("Predecessor product Amazon lookup failed:", e);
    }
  }

  // Tier 3b: any other product/reference page — lightweight title+text fetch.
  try {
    const meta = await fetchPageMeta(trimmed);
    if (meta?.text) {
      const label = meta.title || trimmed;
      return { hasReference: true, label, text: wrapFallbackBlock(label, meta.text.slice(0, 3000)) };
    }
  } catch (e) {
    console.warn("Predecessor product page fetch failed:", e);
  }

  return { hasReference: false, label: trimmed, text: null };
}
