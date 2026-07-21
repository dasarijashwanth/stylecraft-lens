import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { memoryDb } from "@/lib/memoryDb";

// project_generation_state is one-row-per-project (upsert on retry/restart),
// not an append-only job log — so "last 20 generation jobs" reads as "last
// 20 projects the pipeline has touched, most-recent activity first," which
// is accurate at this app's current scale. A true per-attempt audit trail
// would need a new append-only table (mirroring document_field_history's
// pattern) — a reasonable future follow-up if retries become frequent, not
// needed today.
export interface GenerationJobRow {
  projectId: string;
  projectName: string;
  phase: string;
  status: string;
  errorMessage: string | null;
  updatedAt: string;
}

export async function GET() {
  try {
    const session = await getAuthSession();
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabaseAdmin
        .from("project_generation_state")
        .select("project_id, phase, status, error_message, updated_at, projects(name)")
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw error;

      const jobs: GenerationJobRow[] = (data ?? []).map((row: any) => ({
        projectId: row.project_id,
        projectName: row.projects?.name || "(unknown project)",
        phase: row.phase,
        status: row.status,
        errorMessage: row.error_message,
        updatedAt: row.updated_at,
      }));
      return NextResponse.json({ jobs });
    }

    const projectsById = new Map(memoryDb.projects.map(p => [p.id, p]));
    const jobs: GenerationJobRow[] = [...memoryDb.projectGenerationState]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 20)
      .map(row => ({
        projectId: row.projectId,
        projectName: projectsById.get(row.projectId)?.name || "(unknown project)",
        phase: row.phase,
        status: row.status,
        errorMessage: row.errorMessage,
        updatedAt: row.updatedAt.toISOString(),
      }));
    return NextResponse.json({ jobs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load generation jobs" }, { status: 500 });
  }
}
