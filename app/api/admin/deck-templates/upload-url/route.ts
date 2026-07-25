import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

const STORAGE_BUCKET = "deck-templates";

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Real branded .pptx templates routinely run 10-20MB+ (embedded fonts/
// images) — well past Vercel's serverless function request-body limit
// (~4.5MB), which rejects the request at the platform edge before it ever
// reaches app/api/admin/deck-templates's own POST handler. The rejection
// comes back as an HTML error page, which the client's res.json() then
// fails to parse ("Unexpected token '<'"). This issues a signed Supabase
// Storage upload URL so the browser can send the bytes directly to
// Storage instead, bypassing the function entirely for the large part —
// .../finalize then downloads them back server-side (an outbound Storage
// call, not subject to the inbound body limit) to actually parse and
// register the template.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    if (!isSupabaseConfigured) {
      // Local dev / memoryDb fallback has no real Storage bucket to sign a
      // URL for — the direct multipart POST to /api/admin/deck-templates
      // works fine there anyway, since there's no Vercel body-size limit
      // on a local dev server.
      return NextResponse.json({ mode: "direct" });
    }

    const { fileName } = await req.json();
    const path = `${Date.now()}-${(fileName || "template.pptx").replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error) throw error;

    return NextResponse.json({ mode: "signed", path: data.path, token: data.token });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create upload URL" }, { status: err.status || 500 });
  }
}
