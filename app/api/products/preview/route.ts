import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAmazonProduct } from "@/lib/rainforest";
import { resolveAsinFromInput } from "@/lib/analysisEngine";
import { resolveToolType, assertToolType, getToolTypeLabel } from "@/lib/tool-type-taxonomy";
import { listToolTypes } from "@/lib/db/tool-types";
import { RelatedProductPreviewSchema } from "@/lib/validations";
import { fetchPageMeta } from "@/lib/citations";

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Related Products' per-row preview (analyze form's "Related Products"
// field, next to Positioning Context) — unlike the analysis-scoped
// app/api/analyses/[id]/competitors/preview/route.ts, this runs BEFORE an
// analysis exists, so it takes the form's own toolType explicitly instead
// of reading it off an existing analysis, and has no duplicate-ASIN check
// (duplicates across the 3 rows are checked client-side). Auth-only, no
// ownership check needed since it doesn't touch any owned record.
//
// See the sibling competitor-preview route's fuller comment — getAmazonProduct
// can legitimately take well over Vercel's default function duration.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await getAuthSession();
    const body = await request.json();
    const validation = RelatedProductPreviewSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() }, { status: 400 });
    }

    const asin = resolveAsinFromInput(validation.data.asinOrUrl);
    if (!asin) {
      // Not Amazon-resolvable — but any other real product/competitor page
      // URL is still useful as a "related product" reference (discovery
      // context for the AI, shown in the results), it just can't carry
      // Rainforest-sourced price/rating/image data the way an Amazon pick
      // can. Fetch a lightweight title/text preview instead of rejecting it
      // outright; only truly non-URL garbage input still errors below.
      const hostname = safeHostname(validation.data.asinOrUrl.trim());
      if (!hostname) {
        return NextResponse.json({ error: "VALIDATION_FAILED", message: "Enter a valid ASIN, Amazon product URL, or any other product page URL" }, { status: 400 });
      }
      const meta = await fetchPageMeta(validation.data.asinOrUrl.trim());
      if (!meta || !meta.title) {
        // Deliberately honest rather than "check the URL" — the URL is
        // very often fine; fetchPageMeta returns null just as readily for
        // a real page that blocked the fetch (bot-protection challenge
        // page, hard 403, timeout) as for a broken link, and this app has
        // no reliable way to tell those apart from here. Named explicitly
        // so the user knows to try pasting a different reference/source
        // instead of re-checking a URL that was never the problem.
        return NextResponse.json({ error: "NOT_FOUND", message: `Couldn't fetch info from ${hostname} — it may be blocking automated access, or the page may be unreachable. Try a different URL, or an ASIN/Amazon link instead.` }, { status: 404 });
      }
      return NextResponse.json({
        asin: null,
        title: meta.title,
        brand: hostname,
        price: null,
        image: null,
        external: true,
        toolTypeMismatchWarning: null,
      });
    }

    const product = await getAmazonProduct(asin);
    if (!product) {
      return NextResponse.json({ error: "NOT_FOUND", message: `Could not find a real Amazon product for ASIN "${asin}"` }, { status: 404 });
    }

    // Warn, don't block — same reasoning as the existing competitor-preview
    // route: the human is the authority, a mismatch just gets flagged.
    let toolTypeMismatchWarning: string | null = null;
    if (validation.data.requiredToolType) {
      const toolTypes = await listToolTypes();
      if (!assertToolType(product.title, validation.data.requiredToolType, toolTypes).ok) {
        const resolved = resolveToolType(product.title, toolTypes);
        const guessedLabel = resolved?.type ? (toolTypes.find(t => t.type_key === resolved.type)?.label || resolved.type) : "a different tool type";
        const requiredLabel = getToolTypeLabel(validation.data.requiredToolType, toolTypes);
        toolTypeMismatchWarning = `This looks like a ${guessedLabel} — your analysis is for ${requiredLabel}s. It'll still be shown in the Related Products section, but won't be eligible to become one of the discovered competitors.`;
      }
    }

    return NextResponse.json({
      asin,
      title: product.title,
      brand: product.brand,
      price: product.price,
      image: product.image,
      toolTypeMismatchWarning,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
