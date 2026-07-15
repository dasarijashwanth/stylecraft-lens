/** @type {import('next').NextConfig} */
const nextConfig = {
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
