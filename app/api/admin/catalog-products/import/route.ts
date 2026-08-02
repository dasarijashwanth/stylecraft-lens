import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { parseImportFile, normalizeImportRow, diffCatalogImport, NormalizedCatalogRow } from "@/lib/catalog-import";
import { listAllCatalogProducts } from "@/lib/db/catalog-products";
import { listMotorFamilies } from "@/lib/db/motor-families";
import { listBrandedMotorNames } from "@/lib/db/branded-motor-names";
import { listHeatTechFamilies } from "@/lib/db/heat-tech-families";
import { listBrandedHeatTechNames } from "@/lib/db/branded-heat-tech-names";
import { listToolTypes } from "@/lib/db/tool-types";

// Direct multipart upload — a product-catalog spreadsheet is nowhere near
// Vercel's 4.5MB body limit (unlike deck templates, which need the signed-
// URL indirection). A tiny first line of defense against a malformed/huge
// upload, same precedent as deck-templates' MAX_TEMPLATE_SIZE_BYTES.
const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024;

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Parses + normalizes the uploaded spreadsheet (pure parsing, no AI call)
// and diffs it against the current catalog (lib/catalog-import.ts's
// diffCatalogImport) — WRITES NOTHING. The admin reviews {new, changed,
// unchanged, missingFromFile} and POSTs the reviewed rows to import/confirm
// to apply them. missingFromFile rows are informational only — this route
// never deletes anything (the "nothing is silently deleted" requirement).
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > MAX_IMPORT_SIZE_BYTES) {
      return NextResponse.json({ error: `Import file too large (max ${MAX_IMPORT_SIZE_BYTES / 1024 / 1024}MB)` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rawRows = parseImportFile(buffer);

    const ctx = {
      motorFamilies: await listMotorFamilies(),
      brandedMotorNames: await listBrandedMotorNames(),
      heatTechFamilies: await listHeatTechFamilies(),
      brandedHeatTechNames: await listBrandedHeatTechNames(),
      toolTypes: await listToolTypes(),
    };

    const normalizedRows = rawRows.map(r => normalizeImportRow(r, ctx)).filter((r): r is NormalizedCatalogRow => r !== null);
    const existing = await listAllCatalogProducts();
    const diff = diffCatalogImport(normalizedRows, existing);

    return NextResponse.json(diff);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to parse import file" }, { status: err.status || 500 });
  }
}
