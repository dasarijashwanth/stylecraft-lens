import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { markNotificationRead } from "@/lib/db/support-messages";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Only supports marking the in-app notification read — the Topbar bell's
// "new support message" unread flag (see support_messages.admin_notification_read).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    if (body.adminNotificationRead === true) {
      await markNotificationRead(params.id);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update support message" }, { status: err.status || 500 });
  }
}
