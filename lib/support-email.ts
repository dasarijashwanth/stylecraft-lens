// lib/support-email.ts
// Email delivery for Contact Support submissions via Resend. Two emails per
// submission: one to the support inbox (admin notification, retried) and
// one best-effort acknowledgement back to the submitter (never blocks the
// user-facing success response — see app/api/support/contact/route.ts's
// "persistence first, email second" flow).
import { Resend } from "resend";
import type { SupportMessageRow } from "@/lib/db/support-messages";

export const SUPPORT_INBOX_EMAIL = process.env.SUPPORT_INBOX_EMAIL || "jashwanthd@stylecraftus.com";
const SUPPORT_FROM_EMAIL = process.env.SUPPORT_FROM_EMAIL || "Lens Support <lens-support@stylecraftus.com>";

export const TOPIC_LABELS: Record<string, string> = {
  bug: "Bug/Issue",
  question: "Question",
  data_wrong: "Data looks wrong",
  feature_request: "Feature request",
  other: "Other",
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(escaped: string): string {
  return escaped.replace(/\n/g, "<br/>");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function buildContextRows(context: Record<string, any> | null): string[] {
  if (!context) return [];
  const rows: string[] = [];
  if (context.page) rows.push(`Page: ${context.page}`);
  if (context.tab) rows.push(`Tab: ${context.tab}`);
  if (context.projectId) rows.push(`Project: ${context.productName ? `${context.productName} (${context.projectId})` : context.projectId}`);
  if (context.appVersion) rows.push(`App version: ${context.appVersion}`);
  if (context.browser) rows.push(`Browser: ${context.browser}`);
  return rows;
}

function buildAdminEmail(m: SupportMessageRow): { subject: string; html: string; text: string } {
  const topicLabel = TOPIC_LABELS[m.topic] || m.topic;
  const subject = `[Lens Support] ${topicLabel} — ${m.name}`;
  const contextRows = buildContextRows(m.context);
  const submittedAt = new Date(m.created_at).toLocaleString();

  const html = `
    <div style="font-family:sans-serif;font-size:14px;color:#111;line-height:1.5;max-width:600px">
      <p>${nl2br(escapeHtml(m.message))}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0" />
      <p style="color:#555;font-size:13px">
        <strong>From:</strong> ${escapeHtml(m.name)} &lt;${escapeHtml(m.email)}&gt;<br/>
        <strong>Topic:</strong> ${escapeHtml(topicLabel)}<br/>
        <strong>Submitted:</strong> ${escapeHtml(submittedAt)}<br/>
        ${contextRows.map(r => escapeHtml(r)).join("<br/>\n        ")}
      </p>
      ${m.screenshot_url ? `<p><a href="${escapeHtml(m.screenshot_url)}"><img src="${escapeHtml(m.screenshot_url)}" alt="Screenshot" style="max-width:480px;border:1px solid #ddd;border-radius:6px" /></a></p>` : ""}
    </div>
  `.trim();

  const text = [
    m.message,
    "",
    "---",
    `From: ${m.name} <${m.email}>`,
    `Topic: ${topicLabel}`,
    `Submitted: ${submittedAt}`,
    ...contextRows,
    m.screenshot_url ? `Screenshot: ${m.screenshot_url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function buildAckEmail(m: SupportMessageRow): { subject: string; html: string; text: string } {
  const subject = "We received your message — StyleCraft Lens Support";
  const html = `
    <div style="font-family:sans-serif;font-size:14px;color:#111;line-height:1.5;max-width:600px">
      <p>Hi ${escapeHtml(m.name)},</p>
      <p>We received your message and will get back to you soon.</p>
      <p style="color:#555;font-size:13px;border-left:3px solid #ddd;padding-left:10px">${nl2br(escapeHtml(m.message))}</p>
    </div>
  `.trim();
  const text = `Hi ${m.name},\n\nWe received your message and will get back to you soon.\n\n"${m.message}"`;
  return { subject, html, text };
}

async function sendWithRetry(
  opts: { to: string; replyTo?: string; subject: string; html: string; text: string },
  attempts: number
): Promise<{ status: "sent" | "failed"; error?: string }> {
  const resend = getResendClient();
  if (!resend) {
    return { status: "failed", error: "Email provider not configured (RESEND_API_KEY missing)" };
  }

  const delaysMs = [0, 500, 1500];
  let lastError = "Unknown error";
  for (let i = 0; i < attempts; i++) {
    if (delaysMs[i]) await sleep(delaysMs[i]);
    try {
      const { error } = await resend.emails.send({
        from: SUPPORT_FROM_EMAIL,
        to: opts.to,
        replyTo: opts.replyTo,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      if (!error) return { status: "sent" };
      lastError = error.message || String(error);
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }
  return { status: "failed", error: lastError };
}

// Retried 3x — this is the message the admin must actually see, so a
// transient provider hiccup shouldn't drop it (the row is already
// persisted regardless of this outcome — see support_messages.email_status).
export async function sendSupportAdminEmail(m: SupportMessageRow): Promise<{ status: "sent" | "failed"; error?: string }> {
  const { subject, html, text } = buildAdminEmail(m);
  return sendWithRetry({ to: SUPPORT_INBOX_EMAIL, replyTo: m.email, subject, html, text }, 3);
}

// Best-effort, single attempt — never blocks the user's success response.
export async function sendSupportAckEmail(m: SupportMessageRow): Promise<{ status: "sent" | "failed"; error?: string }> {
  const { subject, html, text } = buildAckEmail(m);
  return sendWithRetry({ to: m.email, subject, html, text }, 1);
}
