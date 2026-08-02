import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateCatalogProduct, deactivateCatalogProduct, reactivateCatalogProduct } from "@/lib/db/catalog-products";

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
      importFlags: body.importFlags,
    });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ product });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update catalog product" }, { status: err.status || 500 });
  }
}
