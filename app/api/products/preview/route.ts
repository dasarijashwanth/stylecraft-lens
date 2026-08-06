import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAmazonProduct } from "@/lib/rainforest";
import { resolveAsinFromInput } from "@/lib/analysisEngine";
import { resolveToolType, assertToolType, getToolTypeLabel } from "@/lib/tool-type-taxonomy";
import { listToolTypes } from "@/lib/db/tool-types";
import { RelatedProductPreviewSchema } from "@/lib/validations";

// Related Products' per-row preview (analyze form's "Related Products"
// field, next to Positioning Context) — unlike the analysis-scoped
// app/api/analyses/[id]/competitors/preview/route.ts, this runs BEFORE an
// analysis exists, so it takes the form's own toolType explicitly instead
// of reading it off an existing analysis, and has no duplicate-ASIN check
// (duplicates across the 3 rows are checked client-side). Auth-only, no
// ownership check needed since it doesn't touch any owned record.
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
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Enter a valid ASIN (10 letters/digits) or an Amazon product URL" }, { status: 400 });
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
