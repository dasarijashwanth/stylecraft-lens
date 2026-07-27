import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Exposed client-side so Contact Support submissions (lib/support-email.ts's
    // context block) can auto-attach the app version without manual syncing.
    NEXT_PUBLIC_APP_VERSION: version,
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
