// Mandatory Stage 1 of the competitive-analysis pipeline — identifies what
// the submitted product actually IS via live web search (and any linked
// project's captured Amazon/scrape data) before competitor discovery ever
// runs. This exists because Phase 1/2 previously jumped straight to
// competitor search with unconditional hair-clipper-brand instructions
// regardless of the submitted category — every downstream phase now keys
// off the IdentityCard this produces, never off a hardcoded default.
import type { AnalysisContext } from "./analysisEngine";
import { genAI, hasGeminiKey, GEMINI_MODEL, cleanJsonString } from "./gemini";
import { getAmazonProduct } from "./rainforest";
import { scrapeProductPage } from "./scrape";
import { getProject } from "./db/projects";

export type IdentityStatus = "verified" | "custom_unreleased" | "ambiguous";

export interface IdentityCard {
  productName: string;
  brand: string | null;
  category: string;
  subcategory: string;
  whatItIs: string;
  keyAttributes: string[];
  targetUser: "pro" | "consumer" | "both";
  priceObserved: { value: number; currency: string; source: string } | null;
  confidence: "high" | "medium" | "low";
  evidence: { claim: string; url: string; quote: string }[];
  identityStatus: IdentityStatus;
}

const SYSTEM_PROMPT = `You are identifying a real-world product before any competitive research happens. You have access to web search. Use it.

Identify what this product is using ONLY the search results and any provided product-page/Amazon data below. Do not assume the category. Do not default to any product type — a hair clipper, trimmer, dryer, straightener, shaver, or anything else are all equally likely until the evidence says otherwise.

Rules:
- If the search results and provided data are insufficient to confidently determine the category, set identityStatus to "ambiguous".
- If this appears to be a custom/unreleased product with no web presence, set identityStatus to "custom_unreleased" and derive the category ONLY from the user's own description/attributes provided below. If that description also doesn't state a category, set identityStatus to "ambiguous" instead.
- Every entry in "evidence" must be a verbatim fragment actually found in a search result or the provided page data, with its source URL. Never invent a brand, category, or spec that isn't in the evidence.

Return ONLY valid JSON, no markdown, matching exactly:
{
  "productName": "...",
  "brand": "..." or null,
  "category": "...",
  "subcategory": "...",
  "whatItIs": "1-2 sentence plain description",
  "keyAttributes": ["...", "..."],
  "targetUser": "pro" | "consumer" | "both",
  "priceObserved": { "value": 0, "currency": "USD", "source": "..." } or null,
  "confidence": "high" | "medium" | "low",
  "evidence": [{ "claim": "...", "url": "...", "quote": "..." }],
  "identityStatus": "verified" | "custom_unreleased" | "ambiguous"
}`;

function buildUserPrompt(context: AnalysisContext, snapshotText: string | null): string {
  return `Product name: ${context.productName}
User-provided category (if any): ${context.category || "(not provided)"}
User-provided description: ${context.description || "(none)"}
User-provided motor/tech notes: ${context.motorTech || "(none)"}
User-provided key differentiator: ${context.keyDiff || "(none)"}

${snapshotText ? `<PRODUCT_PAGE_OR_AMAZON_DATA>\n${snapshotText}\n</PRODUCT_PAGE_OR_AMAZON_DATA>\n\n` : ""}Search the web for: "${context.productName}", "${context.productName} specs", "${context.productName} price"${context.category ? `, "${context.category} ${context.productName}"` : ""}. Identify the product from the results.`;
}

// A category the user already stated (at submission time, or via the
// pause-and-ask flow) is always trusted directly — never re-asked once
// present, regardless of what the AI call returns. This is what makes
// "ask ONE question" true rather than a potential re-ask loop.
export function needsUserInput(card: IdentityCard, context: AnalysisContext): boolean {
  if (context.category && context.category.trim().length > 0) return false;
  return card.identityStatus === "ambiguous" || (card.identityStatus === "custom_unreleased" && !card.category?.trim());
}

function normalizeIdentityCard(raw: any, context: AnalysisContext): IdentityCard {
  const status: IdentityStatus =
    raw?.identityStatus === "verified" || raw?.identityStatus === "custom_unreleased" || raw?.identityStatus === "ambiguous"
      ? raw.identityStatus
      : "ambiguous";
  const category = (raw?.category || context.category || "").trim();
  return {
    productName: raw?.productName || context.productName,
    brand: raw?.brand || null,
    category,
    subcategory: (raw?.subcategory || category).trim(),
    whatItIs: raw?.whatItIs || context.description || "",
    keyAttributes: Array.isArray(raw?.keyAttributes) ? raw.keyAttributes : [],
    targetUser: raw?.targetUser === "pro" || raw?.targetUser === "consumer" || raw?.targetUser === "both" ? raw.targetUser : context.targetMarket,
    priceObserved: raw?.priceObserved && typeof raw.priceObserved.value === "number" ? raw.priceObserved : null,
    confidence: raw?.confidence === "high" || raw?.confidence === "medium" ? raw.confidence : "low",
    evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    identityStatus: category ? (status === "ambiguous" ? "custom_unreleased" : status) : status,
  };
}

// Used when no AI provider is available, or the AI call/parse fails.
function fallbackIdentity(context: AnalysisContext): IdentityCard {
  const category = context.category?.trim() || "";
  return {
    productName: context.productName,
    brand: null,
    category,
    subcategory: category,
    whatItIs: context.description || "",
    keyAttributes: [context.motorTech, context.keyDiff].filter(Boolean) as string[],
    targetUser: context.targetMarket,
    priceObserved: null,
    confidence: category ? "medium" : "low",
    evidence: [],
    identityStatus: category ? "custom_unreleased" : "ambiguous",
  };
}

export async function identifyProduct(context: AnalysisContext): Promise<IdentityCard> {
  // Strongest identity source: a linked project's own captured product
  // data (added to the projects table by the TDS real-time-snapshot
  // feature) — reused here rather than duplicating scrape/Rainforest logic.
  let snapshotText: string | null = null;
  if (context.projectId) {
    try {
      const project = await getProject(context.projectId, context.orgId) as any;
      if (project?.asin) {
        const amazonProduct = await getAmazonProduct(project.asin);
        if (amazonProduct) snapshotText = JSON.stringify(amazonProduct);
      }
      if (!snapshotText && project?.productUrl) {
        const scraped = await scrapeProductPage(project.productUrl);
        if (scraped) snapshotText = JSON.stringify(scraped);
      }
    } catch (err) {
      console.warn("Product identification: failed to load linked project's product data:", err);
    }
  }

  if (!hasGeminiKey) {
    return fallbackIdentity(context);
  }

  try {
    const userPrompt = buildUserPrompt(context, snapshotText);
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: userPrompt,
      config: { systemInstruction: SYSTEM_PROMPT, tools: [{ googleSearch: {} }], maxOutputTokens: 2048 },
    });
    if (!response.text) throw new Error(`Empty identification response (finishReason: ${response.candidates?.[0]?.finishReason})`);
    const card = JSON.parse(cleanJsonString(response.text));
    return normalizeIdentityCard(card, context);
  } catch (err) {
    console.warn("Product identification failed, falling back to context-derived identity:", err);
    return fallbackIdentity(context);
  }
}
