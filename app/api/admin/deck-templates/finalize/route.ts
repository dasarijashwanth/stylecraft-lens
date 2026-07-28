import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { parseDeckTemplate } from "@/lib/deck-template-parser";
import { buildDefaultPlaceholderMap } from "@/lib/deck-field-registry";
import { createDeckTemplateFromStoragePath } from "@/lib/db/deck-templates";

export const maxDuration = 30;

const STORAGE_BUCKET = "deck-templates";
// Matches exactly the shape .../upload-url/route.ts generates
// (`${Date.now()}-${sanitized filename}`) — rejects anything else,
// including a path containing "..", before ever calling storage.download.
const TEMPLATE_PATH_RE = /^\d+-[a-zA-Z0-9._-]+$/;
// Same reasoning as app/api/admin/deck-templates/route.ts's direct-upload
// cap — bounds a zip-bomb .pptx's worst-case decompression blowup.
const MAX_TEMPLATE_SIZE_BYTES = 50 * 1024 * 1024;

function requireAdmin(role: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw Object.assign(new Error("Not authorized"), { status: 403 });
  }
}

// Completes the signed-upload-URL flow (see .../upload-url/route.ts) — the
// browser has already PUT the raw bytes straight into Storage; this
// downloads them back server-side to parse and register the template,
// exactly like the direct-upload POST /api/admin/deck-templates route
// does, just sourcing the buffer from Storage instead of the request body.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();
    requireAdmin(session.role);

    const { path, name, fileName } = await req.json();
    if (!path || !TEMPLATE_PATH_RE.test(path)) {
      return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(path);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length > MAX_TEMPLATE_SIZE_BYTES) {
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]);
      return NextResponse.json({ error: `Template file too large (max ${MAX_TEMPLATE_SIZE_BYTES / 1024 / 1024}MB)` }, { status: 400 });
    }

    const parsed = await parseDeckTemplate(buffer);
    const placeholderMap = buildDefaultPlaceholderMap(parsed);

    const template = await createDeckTemplateFromStoragePath({
      name: name || fileName || "Untitled template",
      filePath: path,
      fileName: fileName || path,
      fileSizeBytes: buffer.length,
      slideCount: parsed.slideCount,
      placeholderMap,
      uploadedBy: session.email,
    });

    return NextResponse.json({ template });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to finalize deck template upload" }, { status: err.status || 500 });
  }
}
