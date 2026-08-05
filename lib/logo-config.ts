// Swap-ready config for supplied brand logo/wordmark files — see
// components/ui/Logo.tsx for the render-time resolution logic. No real
// files have been supplied yet (confirmed: no assets/logos/,
// assets/product-logos/, or similarly-named directory exists anywhere in
// this repo) — every entry below starts `null`/empty and every consumer
// gracefully falls back to today's inline-SVG/text placeholder. Adding a
// real file later is a config edit here, never a placement-logic change.
export type ArtworkTone = "light" | "dark";

export interface LogoAsset {
  // Path under public/ (e.g. "/logos/sc-secondary.png").
  file: string;
  // "dark" = the artwork itself is dark-colored (needs CSS invert to read
  // against a dark surface); "light" = the artwork is light-colored (needs
  // invert against a light surface). Drives automatic inversion — never a
  // per-placement manual CSS decision.
  artwork: ArtworkTone;
}

// S|C monogram — app nav brand mark, favicon/app-icon source, loading
// screens, notification icon.
export const APP_LOGO: LogoAsset | null = null;

// S|C PRO lockup — login page, PDF/deck headers, workbook export cover
// cells, footer.
export const PRO_LOCKUP: LogoAsset | null = null;

// Product sub-brand wordmarks — collection identifiers on project cards,
// analysis headers, and document headers. Keyed by the SAME collection name
// lib/db/collections.ts's findCollectionByName already matches against
// (case-insensitive), so this doesn't invent a new key space.
export const COLLECTION_LOGOS: Record<string, LogoAsset> = {};

export function getCollectionLogo(collectionName: string | null | undefined): LogoAsset | null {
  if (!collectionName) return null;
  const key = collectionName.trim().toLowerCase();
  for (const [name, asset] of Object.entries(COLLECTION_LOGOS)) {
    if (name.trim().toLowerCase() === key) return asset;
  }
  return null;
}
