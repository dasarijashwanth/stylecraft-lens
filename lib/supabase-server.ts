// lib/supabase-server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side, cookie-bound Supabase Auth client — used by
// lib/auth.ts's getAuthSession() and app/api/auth/change-password/route.ts.
// Every current call site is a Route Handler (never a Server Component),
// which is allowed to set cookies, so the setAll() try/catch below is a
// defensive no-op guard rather than something actually hit today.
//
// Next.js is pinned at 14.2.3 here, where cookies() is synchronous — this
// changes to an async API in Next 15+; update this helper if this app is
// ever upgraded.
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Only reachable if this were ever called from a Server
            // Component render, which can't write cookies — middleware
            // refreshes the session on every request regardless.
          }
        },
      },
    }
  );
}
