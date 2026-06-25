import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

let clerkMiddleware: any = null;

const hasClerkKeys =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_..." &&
  process.env.CLERK_SECRET_KEY !== "sk_...";

if (hasClerkKeys) {
  try {
    const { authMiddleware } = require("@clerk/nextjs");
    clerkMiddleware = authMiddleware({
      publicRoutes: [
        "/",
        "/sign-in",
        "/sign-up",
        "/api/webhooks/clerk",
      ],
    });
  } catch (e) {
    console.error("Failed to load Clerk middleware:", e);
  }
}

export default function middleware(request: NextRequest, event: any) {
  if (clerkMiddleware) {
    try {
      return clerkMiddleware(request, event);
    } catch (e) {
      console.error("Clerk middleware execution error, bypassing:", e);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
