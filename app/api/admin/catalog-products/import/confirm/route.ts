import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { addCatalogProduct, updateCatalogProduct } from "@/lib/db/catalog-products";
import { NormalizedCatalogRow } from "@/lib/catalog-import";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

interface ConfirmRow {
  row: NormalizedCatalogRow;
  existingId?: string;
}

// Applies exactly the rows the admin reviewed and kept checked in the
// import preview (app/api/admin/catalog-products/import) — an existingId
// present means update that row, absent means insert a new one. Rows the
// admin unchecked, or rows the preview reported as missingFromFile, are
// simply never sent here and stay untouched — nothing is ever deleted by
// this route.
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const { rows } = await request.json() as { rows: ConfirmRow[] };
    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: "rows must be an array" }, { status: 400 });
    }

    let inserted = 0;
    let updated = 0;

    for (const { row, existingId } of rows) {
      if (!row?.name || !row.industry || !row.targetMarket || !row.toolType) continue;
      if (existingId) {
        await updateCatalogProduct(existingId, {
          name: row.name,
          industry: row.industry,
          targetMarket: row.targetMarket,
          toolType: row.toolType,
          targetPrice: row.targetPrice,
          description: row.description,
          motorFamily: row.motorFamily,
          motorBranded: row.motorBranded,
          heatTechFamily: row.heatTechFamily,
          heatTechBranded: row.heatTechBranded,
          importFlags: row.importFlags,
        });
        updated++;
      } else {
        await addCatalogProduct({
          name: row.name,
          industry: row.industry,
          targetMarket: row.targetMarket,
          toolType: row.toolType,
          targetPrice: row.targetPrice,
          description: row.description,
          motorFamily: row.motorFamily,
          motorBranded: row.motorBranded,
          heatTechFamily: row.heatTechFamily,
          heatTechBranded: row.heatTechBranded,
          importFlags: row.importFlags,
          source: row.source,
        });
        inserted++;
      }
    }

    return NextResponse.json({ ok: true, inserted, updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to confirm import" }, { status: err.status || 500 });
  }
}
