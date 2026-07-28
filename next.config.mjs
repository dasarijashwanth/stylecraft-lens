import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

// Tested against a real production build with a real browser (Playwright)
// before shipping, not assumed — an earlier, stricter script-src ('self'
// only) was verified via actual CSP-violation console output to break
// Next.js's OWN framework hydration/RSC-streaming inline scripts (several
// distinct sha256 hashes, clearly first-party Next.js internals, not
// anything in this app's own code — a full grep already confirmed zero
// inline <script> tags and zero dangerouslySetInnerHTML anywhere in this
// codebase). A hash-list or nonce-based script-src would avoid
// 'unsafe-inline' entirely, but Next 14's RSC streaming injects inline
// scripts dynamically in a way that isn't safely nonce-able without
// dedicated engineering + full regression testing this pass didn't have
// room for — disclosed here and in SECURITY_REPORT.md as a known
// remaining gap rather than silently shipping an untested "strict" policy.
// style-src needs 'unsafe-inline' for the same practical reason: React's
// `style={{...}}` prop (used throughout — MagicBento/framer-motion
// animations, the export-pdf.ts star ratings) renders as a real inline
// style="..." attribute; inline CSS can't execute arbitrary JS the way
// inline script could, a materially smaller risk either way.
// img-src allows any https: host (not just 'self') because this app's
// whole purpose is displaying real competitor/product images from
// Amazon/scraped brand sites and Rainforest's own CDN, hosts that can't be
// enumerated in advance — the same reasoning the task's own spec gives for
// this exact directive.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Exposed client-side so Contact Support submissions (lib/support-email.ts's
    // context block) can auto-attach the app version without manual syncing.
    NEXT_PUBLIC_APP_VERSION: version,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          // HSTS only matters over a real HTTPS deployment (Vercel handles
          // that); harmless to send unconditionally, browsers ignore it
          // entirely over plain http:// (e.g. local dev).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // No public registration in this app (single seeded admin account) —
      // permanent server-side redirect rather than a page that just renders
      // a "go sign in" button.
      { source: "/sign-up", destination: "/sign-in", permanent: true },
    ];
  },
};

export default nextConfig;
