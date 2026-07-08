import { NextResponse } from "next/server";
import { getGenerationState } from "@/lib/db/generation-state";

// This GET handler only reads `params.id` (no searchParams/cookies/headers
// usage), which Next.js's route handler cache treats as eligible for
// static caching by default — confirmed via a real stuck-"pending" repro
// where this endpoint kept serving its first-ever response long after the
// underlying project_generation_state row had actually advanced. Force
// dynamic so every call reads the live DB state.
export const dynamic = "force-dynamic";

// Lets the project detail page decide whether to mount
// ProjectGenerationProgress on load — null means no pipeline was ever
// started for this project (no product anchor was given at creation).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const state = await getGenerationState(params.id);
    return NextResponse.json({ state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load pipeline state" }, { status: 500 });
  }
}
