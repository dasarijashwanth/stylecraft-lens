// lib/api-error.ts
// Centralized error response helper — logs the FULL error server-side
// (visible in `vercel logs`) tagged with a request id, and returns only a
// generic message + that id to the client, never raw error.message (which
// can leak internal details: Postgres constraint/column names, Supabase
// internal paths, etc.). Introduced as part of the security pass; most of
// this app's ~66 route handlers still return `err.message` directly
// (documented as a known, systemic finding in SECURITY_REPORT.md — retrofit
// incrementally rather than a single mechanical rewrite of every route in
// this pass). New routes should use this from the start.
import { NextResponse } from "next/server";

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function apiError(err: unknown, fallbackMessage: string, status = 500): NextResponse {
  const requestId = generateRequestId();
  const status2 = (err as any)?.status || status;
  console.error(`[api-error] ${requestId} (${status2}):`, err);
  return NextResponse.json({ error: fallbackMessage, requestId }, { status: status2 });
}
