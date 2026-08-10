import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Must report the TRUE session even when a password change is pending
    // — that's exactly what drives the client-side redirect to
    // /change-password (components/layout/Shell.tsx). See getAuthSession's
    // own header comment for why every other route does NOT pass this.
    const session = await getAuthSession({ allowPendingPasswordChange: true });
    return NextResponse.json({ user: session });
  } catch (error) {
    return NextResponse.json({ user: null });
  }
}
