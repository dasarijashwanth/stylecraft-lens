import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getAuthSession();
    return NextResponse.json({ user: session });
  } catch (error) {
    return NextResponse.json({ user: null });
  }
}
