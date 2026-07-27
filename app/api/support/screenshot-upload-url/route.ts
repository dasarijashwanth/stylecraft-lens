import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";

const STORAGE_BUCKET = "support-screenshots";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg"];

// Same signed-upload-URL bypass as deck templates: even a 5MB screenshot is
// past Vercel's ~4.5MB inbound function body limit, so the browser uploads
// directly to Storage and only a small JSON payload (the resulting path)
// ever hits /api/support/contact.
export async function POST(req: NextRequest) {
  try {
    await getAuthSession(); // any signed-in user may attach a screenshot

    if (!isSupabaseConfigured) {
      // Local dev / memoryDb fallback has no real Storage bucket — the
      // screenshot is simply unavailable there (optional field anyway).
      return NextResponse.json({ mode: "direct" });
    }

    const { fileName, fileSize, contentType } = await req.json();
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json({ error: "Only PNG or JPG screenshots are allowed" }, { status: 400 });
    }
    if (typeof fileSize === "number" && fileSize > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Screenshot must be 5MB or smaller" }, { status: 400 });
    }

    const ext = contentType === "image/png" ? "png" : "jpg";
    const path = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;

    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error) throw error;

    return NextResponse.json({ mode: "signed", path: data.path, token: data.token });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create upload URL" }, { status: err.status || 500 });
  }
}
