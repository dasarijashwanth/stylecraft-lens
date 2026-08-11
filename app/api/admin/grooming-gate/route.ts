import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";
import { listGroomingGateRules, addGroomingGateRule } from "@/lib/db/grooming-gate-rules";

export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "GET /api/admin/grooming-gate");
    const rules = await listGroomingGateRules();
    return NextResponse.json({ rules });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load grooming gate rules" }, { status: err.status || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session, "POST /api/admin/grooming-gate");

    const { ruleType, value, label } = await req.json();
    if (!ruleType || !value) {
      return NextResponse.json({ error: "ruleType and value are required" }, { status: 400 });
    }

    const rule = await addGroomingGateRule({
      ruleType: String(ruleType).trim(),
      value: String(value).trim(),
      label: label ? String(label).trim() : null,
    });
    return NextResponse.json({ rule });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to add grooming gate rule" }, { status: err.status || 500 });
  }
}
