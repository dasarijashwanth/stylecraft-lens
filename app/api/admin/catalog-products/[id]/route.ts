import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateCatalogProduct, deactivateCatalogProduct, reactivateCatalogProduct, getCatalogProduct } from "@/lib/db/catalog-products";
import { isCatalogRowIncomplete } from "@/lib/catalog-import";
import { listToolTypes } from "@/lib/db/tool-types";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Field edits from the admin management page, OR the analyze form's "Save
// changes back to catalog" checkbox (also admin-gated client-side, this
// route is the real enforcement). action:"deactivate"/"reactivate" is a
// soft toggle — never a hard delete, same precedent as legacy_brands.enabled.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const body = await request.json();

    if (body.action === "deactivate") {
      const product = await deactivateCatalogProduct(params.id);
      if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
      return NextResponse.json({ product });
    }
    if (body.action === "reactivate") {
      const product = await reactivateCatalogProduct(params.id);
      if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
      return NextResponse.json({ product });
    }

    // Recomputed here, not trusted from the client (body.importFlags is
    // ignored) — a stale "Incomplete"/"needs confirmation" flag from import
    // time otherwise persists forever once saved once, since nothing else
    // ever revisits it. lib/catalog-import.ts's isCatalogRowIncomplete is
    // the same completeness check normalizeImportRow itself uses, just run
    // against the FINAL merged field values (existing row + this edit)
    // instead of raw import text, so filling in what was missing actually
    // clears the flag. Only the 4 flags this recompute actually understands
    // are replaced — any other flag already on the row (e.g. a one-off
    // script's "preorder_not_yet_shipping") is preserved verbatim rather
    // than silently dropped. tool_type_inferred_from_product IS one of the
    // 4 dropped on any save through this route — an admin reviewing/saving
    // this exact record via this form IS the confirmation that flag exists
    // to prompt.
    const existing = await getCatalogProduct(params.id);
    if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const merged = {
      toolType: body.toolType !== undefined ? body.toolType : existing.tool_type,
      targetPrice: body.targetPrice !== undefined ? body.targetPrice : existing.target_price,
      description: body.description !== undefined ? body.description : existing.description,
      motorFamily: body.motorFamily !== undefined ? body.motorFamily : existing.motor_family,
      heatTechFamily: body.heatTechFamily !== undefined ? body.heatTechFamily : existing.heat_tech_family,
    };
    const toolTypes = await listToolTypes();
    const primaryCriterion = toolTypes.find(t => t.type_key === merged.toolType)?.primary_criterion ?? null;

    const RECOMPUTED_FLAG_TYPES = new Set(["incomplete", "tool_type_needs_review", "tool_type_inferred_from_product", "motor_needs_confirmation", "heat_tech_needs_confirmation"]);
    const preservedFlags = (existing.import_flags || []).filter(f => !RECOMPUTED_FLAG_TYPES.has(f));

    const recomputedFlags: string[] = [...preservedFlags];
    if (!merged.toolType) recomputedFlags.push("tool_type_needs_review");
    if (primaryCriterion === "motor" && !merged.motorFamily) recomputedFlags.push("motor_needs_confirmation");
    if (primaryCriterion === "heat_technology" && !merged.heatTechFamily) recomputedFlags.push("heat_tech_needs_confirmation");
    if (isCatalogRowIncomplete(merged, toolTypes)) recomputedFlags.push("incomplete");

    const product = await updateCatalogProduct(params.id, {
      name: body.name,
      industry: body.industry,
      targetMarket: body.targetMarket,
      toolType: body.toolType,
      targetPrice: body.targetPrice,
      description: body.description,
      motorFamily: body.motorFamily,
      motorBranded: body.motorBranded,
      heatTechFamily: body.heatTechFamily,
      heatTechBranded: body.heatTechBranded,
      brand: body.brand,
      sku: body.sku,
      importFlags: recomputedFlags,
    });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ product });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update catalog product" }, { status: err.status || 500 });
  }
}
