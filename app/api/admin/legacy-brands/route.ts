import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listCategories, listBrandsForCategory } from "@/lib/db/legacy-brands";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Returns every registry category with its brands nested (priority order)
// — the admin page renders all 4 categories as editable chip sets in one
// screen, so one combined fetch is simpler than one round trip per category.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const categories = await listCategories();
    const withBrands = await Promise.all(
      categories.map(async (c) => ({ ...c, brands: await listBrandsForCategory(c.id) }))
    );

    return NextResponse.json({ categories: withBrands });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load legacy brand registry" }, { status: err.status || 500 });
  }
}
