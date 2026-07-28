// lib/html-escape.ts
// Shared escaping helper for every place this app hand-builds an HTML
// string via template literals (lib/export-pdf.ts, lib/support-email.ts,
// app/api/projects/[id]/sales-kit/route.ts) rather than JSX — nothing in
// those files is auto-escaped the way React children are, so every
// untrusted value (user-typed text, AI-generated content, scraped
// competitor/product data) interpolated into one of those templates must
// be passed through this first.
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
