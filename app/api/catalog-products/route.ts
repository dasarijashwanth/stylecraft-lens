import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listCatalogProducts } from "@/lib/db/catalog-products";

// Read-only, no admin gate — the analyze form's catalog picker needs this
// to populate the "StyleCraft Catalog" source option. Active products only
// (see app/api/admin/catalog-products/route.ts for the admin management
// list, which includes inactive rows too). Mirrors app/api/heat-tech-families/route.ts.
export async function GET() {
  try {
    await getAuthSession();
    const products = await listCatalogProducts();
    return NextResponse.json({ products });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load catalog products" }, { status: err.status || 500 });
  }
}
