import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getRecentProvenanceBySection } from "@/lib/db/section-provenance";
import { summarizeDomainHealth } from "@/lib/domain-health";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Read-only rollup of recent lib/brand-site-discovery.ts attempts, so the
// admin can see which registered official_domains are actually resolving
// vs. repeatedly failing (a wrong/stale/renamed domain) without digging
// through raw provenance rows.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const rows = await getRecentProvenanceBySection("brand_site_discovery", 500);
    const health = summarizeDomainHealth(rows);
    return NextResponse.json({ health });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load domain health" }, { status: err.status || 500 });
  }
}
