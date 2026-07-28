import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listSupportMessages } from "@/lib/db/support-messages";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "GET /api/admin/support-messages");
    const messages = await listSupportMessages();
    return NextResponse.json({ messages });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load support messages" }, { status: err.status || 500 });
  }
}
