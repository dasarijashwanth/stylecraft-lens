import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listFaqs } from "@/lib/db/faqs";

// Public (signed-in-user) read — powers /dashboard/help. Enabled FAQs only;
// disabled ones stay admin-only via /api/admin/faqs.
export async function GET() {
  try {
    await getAuthSession();
    const faqs = await listFaqs();
    return NextResponse.json({ faqs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load FAQs" }, { status: err.status || 500 });
  }
}
