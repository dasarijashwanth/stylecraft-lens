import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listSupportMessages } from "@/lib/db/support-messages";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const messages = await listSupportMessages();
    return NextResponse.json({ messages });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load support messages" }, { status: err.status || 500 });
  }
}
