// lib/db/catalog-products.ts
// CRUD over catalog_products — our own product lineup, selectable at the
// analyze form's initial stage to auto-fill every analysis field. Same
// Supabase+memoryDb dual-path style as lib/db/legacy-brands.ts. memoryDb is
// always pre-seeded (see lib/memoryDb.ts's seedCatalogProductDefaults) —
// real default configuration, not an empty admin-fills-it-in table.
// Replaces the old hardcoded lib/stylecraft-products.ts array.
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb, MockCatalogProduct } from "@/lib/memoryDb";

export interface CatalogProductRow {
  id: string;
  name: string;
  industry: string;
  target_market: string;
  tool_type: string;
  target_price: number | null;
  description: string | null;
  motor_family: string | null;
  motor_branded: string | null;
  heat_tech_family: string | null;
  heat_tech_branded: string | null;
  active: boolean;
  import_flags: string[];
  source: string;
  // GTM's "Comparison Chart WEB ONLY" picker needs to search across BOTH
  // house brands with a real SKU; the Manufacturer auto-detect cascade
  // (lib/gtm-tier6-inference.ts) reads `brand` as its most-authoritative
  // signal when an analysis was built from a real catalog pick. Every
  // pre-existing row is backfilled to "StyleCraft" (Section 35's own
  // migration) — null only ever appears for a manually-added row an admin
  // hasn't set yet.
  brand: string | null;
  sku: string | null;
  // GTM style-corpus work — see supabase_schema.sql Section 38. product_kind
  // drives structural N/A for accessory/replacement-part products
  // (lib/gtm-generate.ts's structurallyInapplicableFieldIds); parent_sku
  // links an accessory back to the tool it services; collection is matched
  // against lib/db/collections.ts's narrative-kernel table at generation
  // time. Every pre-existing row defaults product_kind to 'tool' (accurate
  // — every row seeded before this was a full tool, never an accessory).
  product_kind: string;
  parent_sku: string | null;
  collection: string | null;
  created_at: string;
  updated_at: string;
}

function mockToRow(p: MockCatalogProduct): CatalogProductRow {
  return {
    id: p.id,
    name: p.name,
    industry: p.industry,
    target_market: p.targetMarket,
    tool_type: p.toolType,
    target_price: p.targetPrice,
    description: p.description,
    motor_family: p.motorFamily,
    motor_branded: p.motorBranded,
    heat_tech_family: p.heatTechFamily,
    heat_tech_branded: p.heatTechBranded,
    active: p.active,
    import_flags: p.importFlags,
    source: p.source,
    brand: p.brand ?? null,
    sku: p.sku ?? null,
    product_kind: p.productKind ?? "tool",
    parent_sku: p.parentSku ?? null,
    collection: p.collection ?? null,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

// Guards against a nullable array column coming back absent from a row
// added before this column existed — same discipline as legacy-brands.ts's
// normalizeBrandRow.
function normalizeRow(row: any): CatalogProductRow {
  // Guards against product_kind coming back absent from a row selected
  // before Section 38's ALTER TABLE has been run against production —
  // same discipline as import_flags below (lib/db/legacy-brands.ts's
  // normalizeBrandRow has the exact same precedent for a missing column).
  return { ...row, import_flags: row.import_flags || [], product_kind: row.product_kind || "tool" };
}

// Active-only, name-sorted — what the analyze form's catalog picker shows.
export async function listCatalogProducts(): Promise<CatalogProductRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("catalog_products").select("*").eq("active", true).order("name");
    if (error) throw error;
    return (data || []).map(normalizeRow);
  }
  return memoryDb.catalogProducts.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name)).map(mockToRow);
}

// Active + inactive, for the admin management page.
export async function listAllCatalogProducts(): Promise<CatalogProductRow[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from("catalog_products").select("*").order("name");
    if (error) throw error;
    return (data || []).map(normalizeRow);
  }
  return [...memoryDb.catalogProducts].sort((a, b) => a.name.localeCompare(b.name)).map(mockToRow);
}

export async function getCatalogProduct(id: string): Promise<CatalogProductRow | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin.from("catalog_products").select("*").eq("id", id).maybeSingle();
    return data ? normalizeRow(data) : null;
  }
  const row = memoryDb.catalogProducts.find(p => p.id === id);
  return row ? mockToRow(row) : null;
}

export interface CatalogProductInput {
  name: string;
  industry: string;
  targetMarket: string;
  toolType: string;
  targetPrice?: number | null;
  description?: string | null;
  motorFamily?: string | null;
  motorBranded?: string | null;
  heatTechFamily?: string | null;
  heatTechBranded?: string | null;
  importFlags?: string[];
  source?: string;
  brand?: string | null;
  sku?: string | null;
  productKind?: string;
  parentSku?: string | null;
  collection?: string | null;
}

export async function addCatalogProduct(input: CatalogProductInput): Promise<CatalogProductRow> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from("catalog_products")
      .insert({
        name: input.name,
        industry: input.industry,
        target_market: input.targetMarket,
        tool_type: input.toolType,
        target_price: input.targetPrice ?? null,
        description: input.description ?? null,
        motor_family: input.motorFamily ?? null,
        motor_branded: input.motorBranded ?? null,
        heat_tech_family: input.heatTechFamily ?? null,
        heat_tech_branded: input.heatTechBranded ?? null,
        import_flags: input.importFlags || [],
        source: input.source || "manual",
        brand: input.brand ?? null,
        sku: input.sku ?? null,
        product_kind: input.productKind || "tool",
        parent_sku: input.parentSku ?? null,
        collection: input.collection ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return normalizeRow(data);
  }

  const now = new Date();
  const row: MockCatalogProduct = {
    id: `catprod_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    name: input.name,
    industry: input.industry,
    targetMarket: input.targetMarket,
    toolType: input.toolType,
    targetPrice: input.targetPrice ?? null,
    description: input.description ?? null,
    motorFamily: input.motorFamily ?? null,
    motorBranded: input.motorBranded ?? null,
    heatTechFamily: input.heatTechFamily ?? null,
    heatTechBranded: input.heatTechBranded ?? null,
    active: true,
    importFlags: input.importFlags || [],
    source: input.source || "manual",
    brand: input.brand ?? null,
    sku: input.sku ?? null,
    productKind: input.productKind || "tool",
    parentSku: input.parentSku ?? null,
    collection: input.collection ?? null,
    createdAt: now,
    updatedAt: now,
  };
  memoryDb.catalogProducts.push(row);
  return mockToRow(row);
}

export async function updateCatalogProduct(
  id: string,
  patch: Partial<CatalogProductInput> & { active?: boolean }
): Promise<CatalogProductRow | null> {
  if (isSupabaseConfigured) {
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.industry !== undefined) dbPatch.industry = patch.industry;
    if (patch.targetMarket !== undefined) dbPatch.target_market = patch.targetMarket;
    if (patch.toolType !== undefined) dbPatch.tool_type = patch.toolType;
    if (patch.targetPrice !== undefined) dbPatch.target_price = patch.targetPrice;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.motorFamily !== undefined) dbPatch.motor_family = patch.motorFamily;
    if (patch.motorBranded !== undefined) dbPatch.motor_branded = patch.motorBranded;
    if (patch.heatTechFamily !== undefined) dbPatch.heat_tech_family = patch.heatTechFamily;
    if (patch.heatTechBranded !== undefined) dbPatch.heat_tech_branded = patch.heatTechBranded;
    if (patch.importFlags !== undefined) dbPatch.import_flags = patch.importFlags;
    if (patch.active !== undefined) dbPatch.active = patch.active;
    if (patch.brand !== undefined) dbPatch.brand = patch.brand;
    if (patch.sku !== undefined) dbPatch.sku = patch.sku;
    if (patch.productKind !== undefined) dbPatch.product_kind = patch.productKind;
    if (patch.parentSku !== undefined) dbPatch.parent_sku = patch.parentSku;
    if (patch.collection !== undefined) dbPatch.collection = patch.collection;
    const { data, error } = await supabaseAdmin.from("catalog_products").update(dbPatch).eq("id", id).select().single();
    if (error) throw error;
    return normalizeRow(data);
  }

  const row = memoryDb.catalogProducts.find(p => p.id === id);
  if (!row) return null;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.industry !== undefined) row.industry = patch.industry;
  if (patch.targetMarket !== undefined) row.targetMarket = patch.targetMarket;
  if (patch.toolType !== undefined) row.toolType = patch.toolType;
  if (patch.targetPrice !== undefined) row.targetPrice = patch.targetPrice;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.motorFamily !== undefined) row.motorFamily = patch.motorFamily;
  if (patch.motorBranded !== undefined) row.motorBranded = patch.motorBranded;
  if (patch.heatTechFamily !== undefined) row.heatTechFamily = patch.heatTechFamily;
  if (patch.heatTechBranded !== undefined) row.heatTechBranded = patch.heatTechBranded;
  if (patch.importFlags !== undefined) row.importFlags = patch.importFlags;
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.brand !== undefined) row.brand = patch.brand;
  if (patch.sku !== undefined) row.sku = patch.sku;
  if (patch.productKind !== undefined) row.productKind = patch.productKind;
  if (patch.parentSku !== undefined) row.parentSku = patch.parentSku;
  if (patch.collection !== undefined) row.collection = patch.collection;
  row.updatedAt = new Date();
  return mockToRow(row);
}

export async function deactivateCatalogProduct(id: string): Promise<CatalogProductRow | null> {
  return updateCatalogProduct(id, { active: false });
}

export async function reactivateCatalogProduct(id: string): Promise<CatalogProductRow | null> {
  return updateCatalogProduct(id, { active: true });
}

// Case/whitespace-insensitive name match — used by the re-import diff
// (lib/catalog-import.ts) to decide new vs. changed vs. unchanged rows.
export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
