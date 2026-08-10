// Route -> full-viewport background asset/scrim resolution for
// components/scroll/BackgroundStage.tsx. See the "Route mapping resolution"
// section of the approved redesign plan for why each route maps where it
// does (GTM has no route of its own — it's tab state inside
// /dashboard/projects/[id], which is the single most data-dense page in the
// app and gets the "img-3"/strong-scrim treatment as a result).

export type BackgroundAssetKey =
  | "gif-1" | "gif-2" | "img-1" | "img-2" | "img-3" | "img-4"
  // Additive — 2026-08-10 pass. New product videos + site-harvested images,
  // assigned ONLY to routes that had no background at all (see ROUTE_RULES
  // below); none of the 6 keys above were touched.
  | "video-homie-clipper" | "video-homie-shaver" | "video-xhybrid-dryer"
  | "img-collection-saber" | "img-collection-instinct" | "img-collection-reign"
  | "img-collection-homie" | "img-collection-sage" | "img-collection-rogue"
  | "img-homie-nano-shaver" | "img-hero-5";
export type ScrimIntensity = "light" | "medium" | "strong";

export interface RouteBackgroundConfig {
  asset: BackgroundAssetKey;
  scrimIntensity: ScrimIntensity;
}

export type AssetSource =
  | { kind: "video"; mp4: string; webm: string; poster: string }
  | { kind: "image"; src: string };

// Upscaled (see scripts/convert-hero-videos.ts + the upscale pass run before
// this system was built) — hero-1..4 images and both hero videos are now
// real full-viewport-resolution assets, not the original 522-1250px source
// crops.
export const BACKGROUND_ASSETS: Record<BackgroundAssetKey, AssetSource> = {
  "gif-1": { kind: "video", mp4: "/video/hero-1.mp4", webm: "/video/hero-1.webm", poster: "/images/hero-1-poster.jpg" },
  "gif-2": { kind: "video", mp4: "/video/hero-2.mp4", webm: "/video/hero-2.webm", poster: "/images/hero-2-poster.jpg" },
  "img-1": { kind: "image", src: "/images/hero-1.jpg" },
  "img-2": { kind: "image", src: "/images/hero-2.jpg" },
  "img-3": { kind: "image", src: "/images/hero-3.jpg" },
  "img-4": { kind: "image", src: "/images/hero-4.jpg" },
  // Additive — 2026-08-10 pass (see BackgroundAssetKey's own comment).
  "video-homie-clipper": { kind: "video", mp4: "/video/product-homie-clipper.mp4", webm: "/video/product-homie-clipper.webm", poster: "/images/product-homie-clipper-poster.jpg" },
  "video-homie-shaver": { kind: "video", mp4: "/video/product-homie-shaver.mp4", webm: "/video/product-homie-shaver.webm", poster: "/images/product-homie-shaver-poster.jpg" },
  "video-xhybrid-dryer": { kind: "video", mp4: "/video/product-xhybrid-dryer.mp4", webm: "/video/product-xhybrid-dryer.webm", poster: "/images/product-xhybrid-dryer-poster.jpg" },
  "img-collection-saber": { kind: "image", src: "/images/collection-saber.webp" },
  "img-collection-instinct": { kind: "image", src: "/images/collection-instinct.webp" },
  "img-collection-reign": { kind: "image", src: "/images/collection-reign.webp" },
  "img-collection-homie": { kind: "image", src: "/images/collection-homie.webp" },
  "img-collection-sage": { kind: "image", src: "/images/collection-sage.webp" },
  "img-collection-rogue": { kind: "image", src: "/images/collection-rogue.webp" },
  "img-homie-nano-shaver": { kind: "image", src: "/images/homie-nano-shaver.webp" },
  "img-hero-5": { kind: "image", src: "/images/hero-5.webp" },
};

const SCRIM_OPACITY: Record<ScrimIntensity, number> = {
  light: 0.45,
  medium: 0.6,
  strong: 0.75,
};

export function scrimOpacityFor(intensity: ScrimIntensity): number {
  return SCRIM_OPACITY[intensity];
}

// Internal config/tooling screens — not "main views," stay on the plain
// solid surface background (no BackgroundStage at all).
const EXCLUDED_PREFIXES = ["/dashboard/admin"];

interface RouteRule {
  test: (pathname: string) => boolean;
  config: RouteBackgroundConfig;
}

// Ordered most-specific-first — the project-detail regex must run before
// the plain "/dashboard/projects" rule so dynamic ids don't fall through to
// the list-page treatment, and must itself exclude "/new" (a real distinct
// route, not a project id).
const ROUTE_RULES: RouteRule[] = [
  {
    test: (p) => /^\/dashboard\/projects\/(?!new\b)[^/]+/.test(p),
    config: { asset: "img-3", scrimIntensity: "strong" }, // "GTM/Documents" — see header comment
  },
  {
    test: (p) => p === "/dashboard/projects" || p === "/dashboard/projects/new",
    config: { asset: "img-1", scrimIntensity: "medium" },
  },
  {
    test: (p) => p.startsWith("/dashboard/analyze"),
    config: { asset: "img-2", scrimIntensity: "medium" },
  },
  {
    test: (p) => p.startsWith("/dashboard/competitors"),
    config: { asset: "img-2", scrimIntensity: "medium" }, // not named in spec — closest sibling of Analysis
  },
  {
    test: (p) => p.startsWith("/dashboard/reports"),
    config: { asset: "img-3", scrimIntensity: "strong" }, // not named in spec — reports are documents too
  },
  {
    test: (p) => p.startsWith("/dashboard/help"),
    config: { asset: "img-4", scrimIntensity: "light" },
  },
  {
    test: (p) => p.startsWith("/dashboard/settings"),
    config: { asset: "img-4", scrimIntensity: "medium" },
  },
  {
    test: (p) => p === "/dashboard",
    config: { asset: "gif-1", scrimIntensity: "light" },
  },
  {
    // Login has no shared layout with the rest of the app (no (auth)
    // layout.tsx) — its own standalone BackgroundStage mount still goes
    // through this same resolver so there's only one source of truth.
    test: (p) => p === "/sign-in",
    config: { asset: "img-4", scrimIntensity: "medium" },
  },
  // Additive — 2026-08-10 pass. These 4 routes previously had NO
  // background treatment at all (verified via a full route inventory
  // before adding anything) — each gets its own standalone BackgroundStage
  // mount, same pattern as /sign-in above, since none of them share a
  // layout with (app)'s Shell either. Every rule above this point is
  // unchanged.
  {
    test: (p) => p === "/onboarding",
    config: { asset: "video-homie-shaver", scrimIntensity: "medium" },
  },
  {
    test: (p) => p === "/forgot-password",
    config: { asset: "img-collection-instinct", scrimIntensity: "medium" },
  },
  {
    test: (p) => p === "/reset-password",
    config: { asset: "img-hero-5", scrimIntensity: "medium" },
  },
  {
    test: (p) => p === "/change-password",
    config: { asset: "img-collection-sage", scrimIntensity: "medium" },
  },
];

export function resolveRouteBackground(pathname: string | null | undefined): RouteBackgroundConfig | null {
  if (!pathname) return null;
  if (EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  for (const rule of ROUTE_RULES) {
    if (rule.test(pathname)) return rule.config;
  }
  return null;
}
