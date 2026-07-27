// lib/faq-slugs.ts
// Shared category-anchor slugging — used by the /help page itself (section
// ids) and by every contextual "?" deep link (app tabs, project list
// header) so both sides always agree on the anchor without duplicating the
// logic. Safe to import from client components (pure string function).
export function slugifyFaqCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export function faqCategoryHref(category: string): string {
  return `/dashboard/help#cat-${slugifyFaqCategory(category)}`;
}
