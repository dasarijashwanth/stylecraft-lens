import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getBrandedMotorMisses, classifyPendingBrandedMotorMisses, dismissBrandedMotorMiss } from "@/lib/db/motor-families";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Surfaces competitor listing text that plausibly named a proprietary motor
// phrase (mentions "motor") but matched neither the generic taxonomy nor
// the brand's own branded_motor_names entries — see
// lib/motor-extraction.ts's extractCompetitorMotorType, which logs them.
export async function GET() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const misses = await getBrandedMotorMisses();
    return NextResponse.json({ misses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load branded motor misses" }, { status: err.status || 500 });
  }
}

// Admin-triggered only — batches every miss without an ai_guessed_family yet
// into one OpenAI call. Never runs automatically during analysis (keeps AI
// spend off the competitor-scoring hot path entirely).
export async function POST() {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const updated = await classifyPendingBrandedMotorMisses();
    const misses = await getBrandedMotorMisses();
    return NextResponse.json({ updated, misses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to classify branded motor misses" }, { status: err.status || 500 });
  }
}

// Dismisses a (brand, term) pair once an admin has added it to the branded
// map or decided it's not worth tracking.
export async function DELETE(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const { brandName, term } = await req.json();
    if (!brandName || !term) {
      return NextResponse.json({ error: "brandName and term are required" }, { status: 400 });
    }
    await dismissBrandedMotorMiss(String(brandName), String(term));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to dismiss branded motor miss" }, { status: err.status || 500 });
  }
}
