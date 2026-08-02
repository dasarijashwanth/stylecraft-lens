import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listAllCatalogProducts, addCatalogProduct } from "@/lib/db/catalog-products";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Active + inactive, for the Product Catalog admin page's management table.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const products = await listAllCatalogProducts();
    return NextResponse.json({ products });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load catalog products" }, { status: err.status || 500 });
  }
}

// Manual "+ Add product" — a spreadsheet re-import goes through
// import/confirm instead.
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const body = await request.json();
    if (!body.name || !body.industry || !body.targetMarket || !body.toolType) {
      return NextResponse.json({ error: "name, industry, targetMarket, and toolType are required" }, { status: 400 });
    }
    const product = await addCatalogProduct({
      name: body.name,
      industry: body.industry,
      targetMarket: body.targetMarket,
      toolType: body.toolType,
      targetPrice: body.targetPrice ?? null,
      description: body.description ?? null,
      motorFamily: body.motorFamily ?? null,
      motorBranded: body.motorBranded ?? null,
      heatTechFamily: body.heatTechFamily ?? null,
      heatTechBranded: body.heatTechBranded ?? null,
      importFlags: body.importFlags ?? [],
      source: "manual",
    });
    return NextResponse.json({ product });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add catalog product" }, { status: err.status || 500 });
  }
}
