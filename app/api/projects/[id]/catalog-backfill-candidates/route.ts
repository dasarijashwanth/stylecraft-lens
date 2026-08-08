import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getMergedFactsForProject } from "@/lib/db/extracted-facts";
import { listCatalogProducts, updateCatalogProduct } from "@/lib/db/catalog-products";
import { matchCatalogProductByName } from "@/lib/our-product-position";
import { parsePriceToNumber } from "@/lib/price-band";

// Automatic Source-Doc Fact Extraction & Cross-Document Fill, Part 3.6 —
// "if extraction finds values missing on the catalog record (SKU, UPC,
// motor, price), show a 'Update catalog record?' confirmation chip." Only
// motor_family/motor_branded/target_price are real, currently-blank-able
// columns on catalog_products (lib/db/catalog-products.ts's
// CatalogProductRow has no sku/upc field at all) — offered here, never
// auto-applied; confirming is a separate POST.
interface BackfillCandidate {
  catalogField: "motor_family" | "motor_branded" | "target_price";
  currentValue: string | number | null;
  candidateValue: string | number;
  sourceFieldId: string;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const catalogProducts = await listCatalogProducts();
    const matched = matchCatalogProductByName(project.productName, catalogProducts);
    if (!matched) return NextResponse.json({ catalogProductId: null, candidates: [] });

    const merged = await getMergedFactsForProject(params.id);
    const candidates: BackfillCandidate[] = [];

    const motorType = merged.factsByFieldId["motor_type"];
    if (!matched.motor_branded && motorType?.value) {
      candidates.push({ catalogField: "motor_branded", currentValue: matched.motor_branded, candidateValue: motorType.value, sourceFieldId: "motor_type" });
    }

    const retailPrice = merged.factsByFieldId["source_doc_retail_price"] || merged.factsByFieldId["source_doc_salon_price"];
    const retailPriceNum = retailPrice ? parsePriceToNumber(retailPrice.value) : null;
    if (!matched.target_price && retailPriceNum != null) {
      candidates.push({ catalogField: "target_price", currentValue: matched.target_price, candidateValue: retailPriceNum, sourceFieldId: retailPrice!.field_id });
    }

    return NextResponse.json({ catalogProductId: matched.id, candidates });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load catalog back-fill candidates" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId) as any;
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { catalogProductId, catalogField, value } = await req.json();
    if (!catalogProductId || !catalogField) return NextResponse.json({ error: "catalogProductId and catalogField are required" }, { status: 400 });
    if (!["motor_family", "motor_branded", "target_price"].includes(catalogField)) {
      return NextResponse.json({ error: "Unsupported catalogField" }, { status: 400 });
    }

    const patch: any = catalogField === "target_price" ? { targetPrice: value } : catalogField === "motor_branded" ? { motorBranded: value } : { motorFamily: value };
    const updated = await updateCatalogProduct(catalogProductId, patch);
    return NextResponse.json({ product: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update catalog record" }, { status: 500 });
  }
}
