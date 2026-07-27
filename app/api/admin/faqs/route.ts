import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { listAllFaqsForAdmin, addFaq } from "@/lib/db/faqs";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Includes disabled FAQs — the admin editor needs to see and re-enable them.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const faqs = await listAllFaqsForAdmin();
    return NextResponse.json({ faqs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load FAQs" }, { status: err.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { category, question, answer } = await req.json();
    if (!category || !question || !answer) {
      return NextResponse.json({ error: "category, question, and answer are required" }, { status: 400 });
    }

    const faq = await addFaq({
      category: String(category).trim(),
      question: String(question).trim(),
      answer: String(answer),
    });
    return NextResponse.json({ faq });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add FAQ" }, { status: err.status || 500 });
  }
}
