import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";

const STORAGE_BUCKET = "support-screenshots";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg"];

// Same signed-upload-URL bypass as deck templates: even a 5MB screenshot is
// past Vercel's ~4.5MB inbound function body limit, so the browser uploads
// directly to Storage and only a small JSON payload (the resulting path)
// ever hits /api/support/contact.
//
// Security audit note: this route's own `contentType`/`fileSize` checks
// below are declared-value checks only — they gate what URL gets ISSUED,
// not what bytes actually land at it (a signed upload URL isn't bound to a
// declared content-type). The real enforcement is the `support-screenshots`
// bucket's own server-side `allowedMimeTypes`/`fileSizeLimit` Storage
// settings — see scripts/apply-storage-bucket-restrictions.ts, which must
// be run once against the live project (Storage bucket config isn't a SQL
// object, same "created manually" precedent as bucket creation itself).
// Without that, any signed-in user could PUT arbitrary bytes/content-type
// straight to this bucket (which is public) and skip calling
// /api/support/contact entirely, bypassing the magic-byte check that only
// runs there.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(); // any signed-in user may attach a screenshot

    // Security audit fix — bounds how many signed-upload slots (each a
    // real Storage write) one account can mint per hour, independent of
    // whether any upload/contact submission ever completes.
    const rateLimit = await checkRateLimit({ eventType: "screenshot_upload_url", userId: session.userId, maxAttempts: 20, windowMinutes: 60 });
    if (rateLimit.limited) {
      return NextResponse.json({ error: "RATE_LIMITED", message: `Too many upload requests — please wait ${rateLimit.retryAfterMinutes} minutes and try again.` }, { status: 429 });
    }

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
