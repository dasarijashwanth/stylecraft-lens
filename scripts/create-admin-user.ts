// scripts/create-admin-user.ts
// Creates (or safely re-runs against) the one real admin account for
// Supabase Auth. Idempotent: re-running this after the admin has already
// changed their password will NOT force another password change — it only
// resets the password/role if you explicitly ask it to.
//
// Requires the `profiles` table from supabase_schema.sql to already exist —
// run that SQL block in the Supabase SQL editor first (this repo has no
// migrations CLI; schema changes are applied there by hand).
//
// Run with: npx tsx scripts/create-admin-user.ts
// Optional overrides: ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/create-admin-user.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.substring(0, index).trim();
    let val = trimmed.substring(index + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    process.env[key] = val;
  });
  console.log("Successfully loaded environment variables from .env.local");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

// .env.local's NEXT_PUBLIC_SUPABASE_URL has a /rest/v1 suffix baked in
// (a known quirk in this project) — supabase-js appends its own /rest/v1
// and /auth/v1 paths internally, so passing it through as-is breaks the
// Admin Auth API specifically ("Invalid path specified in request URL").
const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, "");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env or .env.local");
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "jashwanthd@stylecraftus.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "stylecraft123";

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email: string) {
  // No direct getUserByEmail in the admin API — paginate and scan.
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
    page++;
  }
}

async function main() {
  const existing = await findUserByEmail(ADMIN_EMAIL);

  if (existing) {
    console.log(`User ${ADMIN_EMAIL} already exists (${existing.id}) — resetting password and confirming email, leaving must_change_password untouched.`);
    const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (updateErr) throw updateErr;

    // Ensure a profile row exists, but never overwrite must_change_password
    // on an existing profile — that's the flag the user's own choice
    // (whether they've already changed their bootstrap password) controls.
    const { data: profile } = await supabase.from("profiles").select("id").eq("id", existing.id).maybeSingle();
    if (!profile) {
      const { error: profileErr } = await supabase.from("profiles").insert({
        id: existing.id,
        email: ADMIN_EMAIL,
        role: "ADMIN",
        must_change_password: true,
      });
      if (profileErr) throw profileErr;
      console.log("Created missing profile row for existing user.");
    } else {
      const { error: profileErr } = await supabase.from("profiles").update({ email: ADMIN_EMAIL, role: "ADMIN" }).eq("id", existing.id);
      if (profileErr) throw profileErr;
    }

    console.log("Done — password reset, existing profile preserved.");
    return;
  }

  console.log(`Creating new admin user ${ADMIN_EMAIL}…`);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw createErr;

  const { error: profileErr } = await supabase.from("profiles").insert({
    id: created.user.id,
    email: ADMIN_EMAIL,
    role: "ADMIN",
    must_change_password: true,
  });
  if (profileErr) throw profileErr;

  console.log(`Done — created admin user ${ADMIN_EMAIL} (${created.user.id}). Must change password on first login.`);
}

main().catch(err => {
  console.error("create-admin-user script failed:", err.message || err);
  process.exit(1);
});
