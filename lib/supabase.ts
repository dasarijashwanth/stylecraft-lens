// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

// Defensive: a local .env.local copy has previously ended up with a
// /rest/v1 suffix baked into NEXT_PUBLIC_SUPABASE_URL (confirmed to break
// supabase-js's client entirely — it appends its own /rest/v1 and /auth/v1
// paths, so a pre-existing suffix produces "Invalid path specified in
// request URL" on every call). Stripping it here is a no-op when the URL is
// already correct (e.g. in production), and self-heals local dev if it recurs.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const isSupabaseConfigured = 
  !!supabaseUrl && 
  !!supabaseAnonKey && 
  supabaseUrl !== "https://xxxxxxxxxxxx.supabase.co" &&
  !supabaseUrl.includes("placeholder");

// Initialize client with fallback values if credentials aren't set
export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : "https://placeholder.supabase.co",
  isSupabaseConfigured ? supabaseAnonKey : "placeholder"
);

// Server-side client (for API routes)
export const supabaseAdmin = createClient(
  isSupabaseConfigured ? supabaseUrl : "https://placeholder.supabase.co",
  isSupabaseConfigured ? (supabaseServiceKey || supabaseAnonKey) : "placeholder"
);
