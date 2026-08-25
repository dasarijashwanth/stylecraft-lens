// lib/csv-safe.ts
// Shared CSV formula-injection guard — cells starting with =, +, -, or @
// are interpreted as formulas by Excel/Sheets when the file is opened,
// letting a malicious competitor name/brand/model-number (scraped, AI-
// generated, or admin-entered) execute a formula on whoever opens the
// export. Prefixing with a single quote defuses this without changing
// what a human sees. Safe to import from both server routes and client
// components (app/(app)/dashboard/competitors/page.tsx) — pure string
// logic, no server-only dependencies.
export function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}
