import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getFaqVoteCounts, getFaqSearchMisses } from "@/lib/db/faqs";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Combined admin view: per-question vote tallies + zero-result search terms
// — surfaces where the FAQ is working (or not) so admins can grow content
// where users actually get stuck (Part 3's explicit requirement).
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const [votes, searchMisses] = await Promise.all([getFaqVoteCounts(), getFaqSearchMisses()]);
    return NextResponse.json({ votes, searchMisses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load FAQ analytics" }, { status: err.status || 500 });
  }
}
