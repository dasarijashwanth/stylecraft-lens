import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupportMessage, countRecentSupportMessages, updateEmailStatus, updateAckEmailStatus } from "@/lib/db/support-messages";
import { sendSupportAdminEmail, sendSupportAckEmail, SUPPORT_INBOX_EMAIL, TOPIC_LABELS } from "@/lib/support-email";
import { detectImageType } from "@/lib/file-magic-bytes";

const STORAGE_BUCKET = "support-screenshots";
const SCREENSHOT_PATH_RE = /^\d+-\d+\.(png|jpg)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_HOUR = 5;

// Persistence-first, email-second: the row is inserted (and the success
// response prepared) before any email send is attempted, so a Resend outage
// never loses a message — only its email_status/ack_email_status reflect
// the delivery outcome, both visible to admins at /dashboard/admin/support-messages.
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession();

    // Domain data in this app is keyed to a fixed pinned literal
    // (session.userId) for real-Supabase-Auth users (see lib/auth.ts) —
    // wrong for per-person rate limiting, so resolve the REAL Supabase
    // Auth user id here when available, same as dismiss-faq-banner's route.
    let identityKey = session.userId;
    if (isSupabaseConfigured) {
      const supabase = createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) identityKey = user.id;
    }

    const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentCount = await countRecentSupportMessages(identityKey, sinceIso);
    if (recentCount >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: `You've reached the ${RATE_LIMIT_PER_HOUR}-message support limit for this hour — please try again shortly, or email ${SUPPORT_INBOX_EMAIL} directly.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : session.email;
    const topic = typeof body.topic === "string" ? body.topic : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const screenshotPath = typeof body.screenshotPath === "string" ? body.screenshotPath : null;
    const rawContext = body.context && typeof body.context === "object" ? body.context : {};

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }
    if (!TOPIC_LABELS[topic]) {
      return NextResponse.json({ error: "Please choose a valid topic" }, { status: 400 });
    }
    if (message.length < 10 || message.length > 2000) {
      return NextResponse.json({ error: "Message must be between 10 and 2000 characters" }, { status: 400 });
    }
    if (screenshotPath && !SCREENSHOT_PATH_RE.test(screenshotPath)) {
      return NextResponse.json({ error: "Invalid screenshot reference" }, { status: 400 });
    }

    let screenshotUrl: string | null = null;
    if (screenshotPath && isSupabaseConfigured) {
      // The browser uploaded these bytes directly to Storage via a signed
      // URL (bypassing Vercel's request-body limit — see
      // /api/support/screenshot-upload-url), so this server never saw the
      // actual content at upload time. Verify it's a real PNG/JPEG by file
      // signature now, before ever linking it into an email/admin view —
      // a spoofed Content-Type there would otherwise go completely
      // unchecked. Degrades gracefully: an invalid file just means no
      // screenshot on this submission, never a failed submit.
      const { data: downloaded, error: downloadError } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(screenshotPath);
      if (!downloadError && downloaded) {
        const buffer = Buffer.from(await downloaded.arrayBuffer());
        if (detectImageType(buffer)) {
          const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(screenshotPath);
          screenshotUrl = data.publicUrl;
        } else {
          await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([screenshotPath]);
        }
      }
    }

    // Only known keys — never store an arbitrary client-supplied blob in JSONB.
    const context = {
      page: typeof rawContext.page === "string" ? rawContext.page.slice(0, 300) : undefined,
      tab: typeof rawContext.tab === "string" ? rawContext.tab.slice(0, 100) : undefined,
      projectId: typeof rawContext.projectId === "string" ? rawContext.projectId.slice(0, 100) : undefined,
      productName: typeof rawContext.productName === "string" ? rawContext.productName.slice(0, 200) : undefined,
      appVersion: typeof rawContext.appVersion === "string" ? rawContext.appVersion.slice(0, 50) : undefined,
      browser: typeof rawContext.browser === "string" ? rawContext.browser.slice(0, 200) : undefined,
    };

    const record = await createSupportMessage({
      userId: identityKey,
      name: session.name,
      email,
      topic,
      message,
      context,
      screenshotUrl,
    });

    // Now that the message is durably stored, attempt delivery — failures
    // here are recorded on the row, never re-thrown as a request failure.
    const adminResult = await sendSupportAdminEmail(record);
    await updateEmailStatus(record.id, adminResult.status, adminResult.error ?? null);

    // Security audit fix — always ack to the real, session-authenticated
    // email, never the client-editable "contact email" field (see
    // sendSupportAckEmail's own header comment).
    const ackResult = await sendSupportAckEmail(record, session.email);
    await updateAckEmailStatus(record.id, ackResult.status);

    return NextResponse.json({ ok: true, id: record.id, emailStatus: adminResult.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to send message" }, { status: err.status || 500 });
  }
}
