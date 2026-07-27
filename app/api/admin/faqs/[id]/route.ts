import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { updateFaq, deleteFaq } from "@/lib/db/faqs";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const body = await req.json();
    const patch: { category?: string; question?: string; answer?: string; enabled?: boolean; sortOrder?: number } = {};
    if (typeof body.category === "string") patch.category = body.category.trim();
    if (typeof body.question === "string") patch.question = body.question.trim();
    if (typeof body.answer === "string") patch.answer = body.answer;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    const faq = await updateFaq(params.id, patch);
    if (!faq) return NextResponse.json({ error: "FAQ not found" }, { status: 404 });
    return NextResponse.json({ faq });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update FAQ" }, { status: err.status || 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    await deleteFaq(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete FAQ" }, { status: err.status || 500 });
  }
}
