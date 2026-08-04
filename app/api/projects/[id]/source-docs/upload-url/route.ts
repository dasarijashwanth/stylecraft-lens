import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

const STORAGE_BUCKET = "project-source-docs";

// Uploaded TDS Ingestion — same signed-upload-URL bypass as
// app/api/admin/gtm-workbook-templates/upload-url, project-scoped instead
// of admin-only. A real TDS PDF/XLSX/DOCX can exceed Vercel's ~4.5MB
// inbound body limit, so the browser uploads directly to Storage and
// .../finalize downloads it back server-side (an outbound call, not
// subject to that limit) to actually parse and register it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    if (!isSupabaseConfigured) {
      // Local dev / memoryDb fallback has no real Storage bucket to sign a
      // URL for — the direct multipart POST to /api/projects/[id]/source-docs
      // works fine there anyway, since there's no Vercel body-size limit on
      // a local dev server.
      return NextResponse.json({ mode: "direct" });
    }

    const { fileName } = await req.json();
    const path = `${params.id}/${Date.now()}-${(fileName || "source-doc").replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error) throw error;

    return NextResponse.json({ mode: "signed", path: data.path, token: data.token });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create upload URL" }, { status: err.status || 500 });
  }
}
