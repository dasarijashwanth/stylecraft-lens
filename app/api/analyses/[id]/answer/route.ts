import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getAnalysis, mergeAnalysisContext } from "@/lib/db/analyses";
import { resolveToolType, type ToolType } from "@/lib/tool-type-taxonomy";
import { listToolTypes } from "@/lib/db/tool-types";
import type { ToolTypeRow } from "@/lib/db/tool-types";

// Free-text -> one of the 3 tiers lib/our-product-position.ts's
// percentileForManualTier expects — accepts "flagship"/"premium", "entry"/
// "budget", defaulting anything else (including plain "mid") to "mid" (the
// neutral middle, never a guess toward either extreme).
function normalizeLineupTierAnswer(answer: string): "flagship" | "mid" | "entry" {
  const lower = answer.toLowerCase();
  if (/(flagship|premium|top)/.test(lower)) return "flagship";
  if (/(entry|budget|basic|starter)/.test(lower)) return "entry";
  return "mid";
}

// Free-text -> a real ToolType, or null if it can't be resolved cleanly
// (still ambiguous, or no recognized tool-type word at all) — never a
// silent guess, since a wrong guess here is exactly the clipper/trimmer
// contamination lib/tool-type-taxonomy.ts exists to prevent. A null
// result is rejected below with a 400 asking the user to be specific.
function normalizeToolTypeAnswer(answer: string, toolTypes: ToolTypeRow[]): ToolType | null {
  const resolved = resolveToolType(answer, toolTypes);
  if (resolved && !resolved.ambiguous && resolved.type) return resolved.type;
  return null;
}

// Answers a paused question — Product Identification (see
// lib/product-identification.ts's needsUserInput gate), a missing target
// price, a missing motor type, or a missing lineup tier (see
// lib/analysisEngine.ts's resolveDiscoveryTargetPrice/resolveOurMotorType/
// resolveOurLineupTier gates in Phase 1/2). Merges the answer into the
// matching context field and clears pending_question — phase stays where
// it is, so the next POST .../continue simply re-attempts whatever paused,
// which now trusts the user-supplied value directly rather than pausing
// again. `pending_question.field` defaults to "category" for old paused
// questions that predate this field (never explicitly set). "motorType"
// merges into motorTech — the SAME context field the analyze/project-new
// forms' existing "Motor technology" select already populates, so
// resolveOurMotorType's existing motorTech-matching step picks it up with
// no new context field needed.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const { answer } = await request.json() as { answer: string };
    if (!answer || !answer.trim()) {
      return NextResponse.json({ error: "ANSWER_REQUIRED", message: "An answer is required" }, { status: 400 });
    }

    const existing = await getAnalysis(params.id);
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
    }
    if (existing.user_id !== session.userId) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Not your analysis" }, { status: 403 });
    }

    const pausedField = existing.pending_question?.field;
    const field =
      pausedField === "pricePoint" ? "pricePoint" :
      pausedField === "motorType" ? "motorTech" :
      pausedField === "lineupTier" ? "lineupTier" :
      pausedField === "toolType" ? "toolType" :
      "category";

    let value: string;
    if (field === "lineupTier") {
      value = normalizeLineupTierAnswer(answer.trim());
    } else if (field === "toolType") {
      const toolTypes = await listToolTypes();
      const resolved = normalizeToolTypeAnswer(answer.trim(), toolTypes);
      if (!resolved) {
        return NextResponse.json(
          { error: "VALIDATION_FAILED", message: `Please answer with one exact tool type: ${toolTypes.filter(t => t.enabled).map(t => t.label).join(", ")}` },
          { status: 400 }
        );
      }
      value = resolved;
    } else {
      value = answer.trim();
    }
    await mergeAnalysisContext(params.id, { [field]: value });
    const analysis = await getAnalysis(params.id);
    return NextResponse.json({ analysis });
  } catch (error: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: error.message }, { status: 500 });
  }
}
