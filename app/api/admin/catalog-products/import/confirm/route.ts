import { NextResponse } from "next/server";
import { z } from "zod";
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

// Security audit fix — this route (already admin-gated) previously trusted
// the client-submitted JSON body's row shape with only a presence check on
// 4 fields (`!row?.name || ...`) — no type check on any field, no length
// caps on free-text columns, nothing stopping a hand-crafted request from
// writing malformed data (e.g. targetPrice as a non-numeric string) that
// bypasses whatever the /import preview step actually computed. Kept
// intentionally lenient on industry/targetMarket (real string, not a
// strict enum) since this ingests legacy/historical spreadsheet data that
// doesn't always match the newer 2-value enum used by the analyze form.
//
// industry/targetMarket/toolType are genuinely nullable at this point —
// lib/catalog-import.ts's normalizeImportRow already leaves any of the
// three null when the spreadsheet's own column is blank or doesn't match a
// known value (flagged "*_needs_review" in importFlags, not silently
// dropped). Requiring non-null here (as this schema previously did, via
// z.string().min(1) with no .nullable()) meant a SINGLE incomplete row
// anywhere in the file failed z.array's validation for the ENTIRE batch —
// "Product Catalog import file validation failed" for every row, not just
// the incomplete one. The per-row completeness check below (`!row.industry
// || ...`) already exists specifically to skip an incomplete row on its
// own — this schema must allow null through to reach it.
const ConfirmRowSchema = z.object({
  row: z.looseObject({
    name: z.string().min(1).max(255),
    industry: z.string().max(100).nullable(),
    targetMarket: z.string().max(50).nullable(),
    toolType: z.string().max(100).nullable(),
    targetPrice: z.number().nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    motorFamily: z.string().max(100).nullable().optional(),
    motorBranded: z.string().max(200).nullable().optional(),
    heatTechFamily: z.string().max(100).nullable().optional(),
    heatTechBranded: z.string().max(200).nullable().optional(),
    brand: z.string().max(200).nullable().optional(),
    sku: z.string().max(100).nullable().optional(),
    upc: z.string().max(20).nullable().optional(),
    importFlags: z.array(z.string().max(50)).max(20).optional(),
    source: z.string().max(100).optional(),
  }).passthrough(),
  existingId: z.string().max(100).optional(),
});
const ConfirmBodySchema = z.object({ rows: z.array(ConfirmRowSchema).max(5000) });

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
    const body = await request.json();
    const validation = ConfirmBodySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "VALIDATION_FAILED", message: "Invalid row data", details: validation.error.flatten() }, { status: 400 });
    }
    const rows = validation.data.rows as ConfirmRow[];

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
          brand: row.brand,
          sku: row.sku,
          upc: row.upc,
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
          brand: row.brand,
          sku: row.sku,
          upc: row.upc,
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
