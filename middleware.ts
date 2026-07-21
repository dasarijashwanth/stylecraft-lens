import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase-middleware";

// Real route protection — previously this file only wired up Clerk's
// middleware when real Clerk keys were configured (they never were) and
// was otherwise a total no-op passthrough, meaning zero routes were
// actually protected. Now: refresh the Supabase session on every request,
// then gate /dashboard/** pages (redirect to /sign-in) and /api/** routes
// (401 JSON) — the API gate goes beyond the literal "login page" ask
// because leaving e.g. /api/projects directly curl-able while only
// protecting pages would leave the actual data unprotected.
const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up"];

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, user } = await updateSession(request);

  if (PUBLIC_PATHS.includes(pathname)) {
    return response;
  }

  if (pathname.startsWith("/api/auth/") || pathname === "/api/health") {
    return response;
  }

  if (pathname.startsWith("/api/")) {
    if (!user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    return response;
  }

  // Everything else (/dashboard/**, /change-password, /onboarding, etc.) —
  // /change-password still requires a real session (you must be logged in,
  // just with mustChangePassword=true, to change your own password); the
  // finer-grained "you must change it before doing anything else" redirect
  // is a client-side concern (components/layout/Shell.tsx), not this gate.
  if (!user) {
    const redirectUrl = new URL("/sign-in", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
