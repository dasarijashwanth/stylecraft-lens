// lib/supabase-middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

// Refreshes the Supabase session cookie on every request and reports
// whether the request is authenticated — the two things middleware.ts
// needs. Uses getUser() rather than getSession(): it revalidates against
// the Auth server instead of trusting an unverified local JWT, which is
// the safer default for something deciding "is this request allowed through."
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  return { response, user };
}
