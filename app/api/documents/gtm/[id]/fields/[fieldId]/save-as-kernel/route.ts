import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { getDocumentById, getDocumentFields, flattenDocumentFields } from "@/lib/db/documents";
import { listCatalogProducts } from "@/lib/db/catalog-products";
import { matchCatalogProductByName } from "@/lib/our-product-position";
import { findCollectionByName, addCollection, updateCollection } from "@/lib/db/collections";
import { isRealAnswer } from "@/lib/field-answer-state";

// GTM style-corpus work, Part C — "Save as collection kernel". Only
// product_name_origin makes sense as a kernel source (it's the field that
// actually tells the origin story; name_story_tie is product-specific
// adaptation, not the shared story itself). Lets whoever writes the FIRST
// product's Name Origin in a brand-new collection seed the stored kernel,
// so every later product in that same line has something real to adapt
// from (lib/gtm-features-and-tip.ts's applyCollectionKernelAdaptation) —
// the exact real-world workflow the 4 real Homie/360 Jeezy GTM sheets show
// (write once, adapt for every sibling SKU).
export async function POST(req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  try {
    const session = await getAuthSession();
    if (params.fieldId !== "product_name_origin") {
      return NextResponse.json({ error: "Only Product Name Origin can be saved as a collection kernel." }, { status: 400 });
    }

    const document = await getDocumentById(params.id);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const project = await getProject(document.project_id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [catalogProducts, fields] = await Promise.all([listCatalogProducts(), getDocumentFields(document.id)]);
    const matched = matchCatalogProductByName(project.productName, catalogProducts);
    const collectionName = matched?.collection?.trim();
    if (!collectionName) {
      return NextResponse.json({ error: "This product isn't linked to a Product Catalog record with a Collection set." }, { status: 400 });
    }

    const answer = flattenDocumentFields(fields)["product_name_origin"];
    if (!isRealAnswer(answer)) {
      return NextResponse.json({ error: "Generate a real Product Name Origin answer first." }, { status: 400 });
    }

    const existing = await findCollectionByName(collectionName);
    const collection = existing
      ? await updateCollection(existing.id, { narrativeKernel: answer! })
      : await addCollection({ name: collectionName, narrativeKernel: answer! });

    return NextResponse.json({ collection });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save collection kernel" }, { status: 500 });
  }
}
