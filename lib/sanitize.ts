// lib/sanitize.ts
// Cleans verbatim vendor text (e.g. an Amazon listing's description) for
// safe, consistent rendering across the app and PDFs — strips HTML,
// decodes entities, and normalizes smart quotes/dashes to ASCII so
// react-pdf's Helvetica (and the print-to-PDF path) never reproduce the
// mojibake class of bug already fixed elsewhere in this codebase.
export function sanitizeText(input: unknown): string | null {
  if (input == null) return null;
  let s = String(input);
  if (!s.trim()) return null;

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  s = s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => entities[m] ?? m);

  s = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");

  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return s.length ? s : null;
}
