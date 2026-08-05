import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProject } from "@/lib/db/projects";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { inferFormatFromFileName, MAX_SOURCE_DOC_SIZE_BYTES, ACCEPTED_SOURCE_DOC_TYPES_LABEL } from "@/lib/tds-doc-ingest";
import { logCall } from "@/lib/obs";

const STORAGE_BUCKET = "project-source-docs";

// Uploaded TDS Ingestion — same signed-upload-URL bypass as
// app/api/admin/gtm-workbook-templates/upload-url, project-scoped instead
// of admin-only. A real TDS PDF/XLSX/DOCX can exceed Vercel's ~4.5MB
// inbound body limit, so the browser uploads directly to Storage and
// .../finalize downloads it back server-side (an outbound call, not
// subject to that limit) to actually parse and register it.
//
// Type/size are validated HERE, before minting the signed URL — not just
// later in finalize — so a wrong-type or oversized file never gets a
// wasted round-trip to Storage first (mirrors the same pre-check
// app/api/support/screenshot-upload-url already does). `fileSize` is the
// client's own declared size; finalize independently re-checks the ACTUAL
// downloaded size, so a forged declaration here is never trusted for
// anything beyond an early, friendlier rejection.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const routeStartTime = Date.now();
  try {
    const session = await getAuthSession();
    const project = await getProject(params.id, session.orgId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { fileName, fileSize, docType } = await req.json();

    if (!inferFormatFromFileName(fileName || "")) {
      logCall("source-doc-upload", { op: "presign", projectId: params.id, docType, outcome: "error", errorMessage: "unsupported file type", elapsedMs: Date.now() - routeStartTime });
      return NextResponse.json({ error: `File type not accepted — upload ${ACCEPTED_SOURCE_DOC_TYPES_LABEL}` }, { status: 400 });
    }
    if (typeof fileSize === "number" && fileSize > MAX_SOURCE_DOC_SIZE_BYTES) {
      const actualMb = (fileSize / 1024 / 1024).toFixed(1);
      const maxMb = MAX_SOURCE_DOC_SIZE_BYTES / 1024 / 1024;
      logCall("source-doc-upload", { op: "presign", projectId: params.id, docType, fileSizeBytes: fileSize, outcome: "error", errorMessage: "file too large", elapsedMs: Date.now() - routeStartTime });
      return NextResponse.json({ error: `File is ${actualMb} MB — max is ${maxMb} MB` }, { status: 400 });
    }

    if (!isSupabaseConfigured) {
      // Local dev / memoryDb fallback has no real Storage bucket to sign a
      // URL for — the direct multipart POST to /api/projects/[id]/source-docs
      // works fine there anyway, since there's no Vercel body-size limit on
      // a local dev server.
      return NextResponse.json({ mode: "direct" });
    }

    const path = `${params.id}/${Date.now()}-${(fileName || "source-doc").replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error) {
      logCall("source-doc-upload", { op: "presign", projectId: params.id, docType, outcome: "error", errorMessage: error.message, elapsedMs: Date.now() - routeStartTime });
      throw error;
    }

    logCall("source-doc-upload", { op: "presign", projectId: params.id, docType, fileSizeBytes: fileSize, outcome: "ok", elapsedMs: Date.now() - routeStartTime });
    // signedUrl is returned so the client can PUT directly to it via a raw
    // XMLHttpRequest (for real upload-progress events, which the
    // supabase-js SDK's own uploadToSignedUrl helper doesn't expose) — the
    // token embedded in the URL is itself sufficient authorization, no
    // separate auth header needed (confirmed: a bare PUT with only
    // Content-Type/cache-control/x-upsert headers succeeds).
    return NextResponse.json({ mode: "signed", path: data.path, token: data.token, signedUrl: data.signedUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create upload URL" }, { status: err.status || 500 });
  }
}
