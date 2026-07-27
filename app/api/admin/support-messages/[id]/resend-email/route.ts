import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getSupportMessage, updateEmailStatus } from "@/lib/db/support-messages";
import { sendSupportAdminEmail } from "@/lib/support-email";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Manual retry for a message whose admin notification email previously
// failed (visible in the admin list's email_status column) — re-runs the
// same retried send, never re-sends the submitter's acknowledgement email.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const record = await getSupportMessage(params.id);
    if (!record) return NextResponse.json({ error: "Support message not found" }, { status: 404 });

    const result = await sendSupportAdminEmail(record);
    await updateEmailStatus(record.id, result.status, result.error ?? null);

    return NextResponse.json({ ok: true, emailStatus: result.status, error: result.error });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to resend email" }, { status: err.status || 500 });
  }
}
