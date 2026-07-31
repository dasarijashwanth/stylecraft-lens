import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis } from "@/lib/db/analyses";
import { getAmazonProduct } from "@/lib/rainforest";
import { resolveAsinFromInput } from "@/lib/analysisEngine";
import { resolveToolType, assertToolType } from "@/lib/tool-type-taxonomy";
import { listToolTypes } from "@/lib/db/tool-types";
import { CompetitorPreviewSchema } from "@/lib/validations";

// Read-only lookup for the "confirm before replacing" panel — no writes,
// no forced-fresh refetch (a cached hit is fine for a preview; the actual
// replace endpoint force-refetches). Same auth/ownership pattern as
// app/api/analyses/[id]/answer/route.ts.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const body = await request.json();
    const validation = CompetitorPreviewSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Validation failed", details: validation.error.flatten() }, { status: 400 });
    }

    const existing = await getAnalysis(params.id);
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
    }
    if (existing.user_id !== session.userId) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Not your analysis" }, { status: 403 });
    }

    const asin = resolveAsinFromInput(validation.data.asinOrUrl);
    if (!asin) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Enter a valid ASIN (10 letters/digits) or an Amazon product URL" }, { status: 400 });
    }

    const product = await getAmazonProduct(asin);
    if (!product) {
      return NextResponse.json({ error: "NOT_FOUND", message: `Could not find a real Amazon product for ASIN "${asin}"` }, { status: 404 });
    }

    // Warn, don't block — the human is the authority here (see
    // lib/analysisEngine.ts's replaceCompetitor header comment).
    const requiredToolType = existing.phase0_result?.toolType || existing.context?.toolType || null;
    let toolTypeMismatchWarning: string | null = null;
    if (requiredToolType) {
      const toolTypes = await listToolTypes();
      if (!assertToolType(product.title, requiredToolType, toolTypes).ok) {
        const resolved = resolveToolType(product.title, toolTypes);
        const guessedLabel = resolved?.type ? (toolTypes.find(t => t.type_key === resolved.type)?.label || resolved.type) : "a different tool type";
        const requiredLabel = toolTypes.find(t => t.type_key === requiredToolType)?.label || requiredToolType;
        toolTypeMismatchWarning = `This looks like a ${guessedLabel} — your analysis is for ${requiredLabel}s. Replace anyway?`;
      }
    }

    const existingAsins = new Set([
      ...((existing.phase1_result?.competitors || []).map((c: any) => c.asin)),
      ...((existing.phase2_result?.competitors || []).map((c: any) => c.asin)),
    ].filter(Boolean));
    const duplicateAsin = existingAsins.has(asin);

    return NextResponse.json({
      asin,
      title: product.title,
      brand: product.brand,
      price: product.price,
      image: product.image,
      toolTypeMismatchWarning,
      duplicateAsin,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
