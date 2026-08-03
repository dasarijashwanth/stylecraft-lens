import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

const STORAGE_BUCKET = "gtm-workbook-templates";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Same signed-upload-URL bypass as app/api/admin/deck-templates/upload-url
// — a real multi-tab .xlsx can exceed Vercel's ~4.5MB inbound body limit,
// so the browser uploads directly to Storage and .../finalize downloads it
// back server-side (an outbound call, not subject to that limit) to
// actually parse and register the template.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    if (!isSupabaseConfigured) {
      // Local dev / memoryDb fallback has no real Storage bucket to sign a
      // URL for — the direct multipart POST to /api/admin/gtm-workbook-templates
      // works fine there anyway, since there's no Vercel body-size limit
      // on a local dev server.
      return NextResponse.json({ mode: "direct" });
    }

    const { fileName } = await req.json();
    const path = `${Date.now()}-${(fileName || "template.xlsx").replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error) throw error;

    return NextResponse.json({ mode: "signed", path: data.path, token: data.token });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create upload URL" }, { status: err.status || 500 });
  }
}
