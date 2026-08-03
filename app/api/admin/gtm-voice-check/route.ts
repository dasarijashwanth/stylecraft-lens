import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { runGtmVoiceCheck } from "@/lib/gtm-voice-batch-check";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Brand Voice Guide, Part 5 — re-lints an already-generated GTM document's
// written fields against the current voice guide, flagging (never
// rewriting) whatever violates. Human-edited fields are always skipped.
// lib/gtm-voice-batch-check.ts itself takes a raw projectId with no org
// awareness — ownership is checked here via getProject(id, session.orgId),
// same pattern this codebase uses everywhere else for project-scoped routes.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);
    const body = await req.json();
    if (!body.projectId || typeof body.projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    const project = await getProject(body.projectId, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const summary = await runGtmVoiceCheck(body.projectId, session.email);
    if (!summary.documentFound) {
      return NextResponse.json({ error: "This project has no GTM document yet" }, { status: 404 });
    }
    return NextResponse.json({ summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Voice check failed" }, { status: err.status || 500 });
  }
}
