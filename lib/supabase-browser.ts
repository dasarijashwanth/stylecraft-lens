// lib/supabase-browser.ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

// Client-side Supabase Auth client — used by the sign-in form, the
// change-password form/flow, and logout(). Keeps the same env var names
// lib/supabase.ts already uses (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY),
// rather than Supabase's newer "publishable key" terminology, since those
// are the values already configured in this app.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  );
}
