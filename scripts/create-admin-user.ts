// scripts/create-admin-user.ts
// Creates (or safely re-runs against) the one real admin account for
// Supabase Auth. Idempotent: re-running this after the admin has already
// changed their password will NOT force another password change — it only
// resets the password/role if you explicitly ask it to (ADMIN_RESET_PASSWORD=true).
//
// Security audit fix — this script used to hardcode a real fallback
// password ("stylecraft123", for the real jashwanthd@stylecraftus.com
// account) and ALWAYS overwrote an existing user's password on every
// re-run regardless of whether they'd already changed it — silently
// reverting a real admin's chosen password back to the known default
// while leaving must_change_password untouched (so the UI never even
// prompted a re-change). ADMIN_PASSWORD is now REQUIRED (no fallback —
// this repo's .env.local is never committed, but a hardcoded credential
// in the script itself is a permanent, always-readable secret regardless);
// an existing user's password is only ever touched with explicit opt-in,
// and doing so always re-flags must_change_password so the account isn't
// left silently sitting on a reset-to-known-value password.
//
// Requires the `profiles` table from supabase_schema.sql to already exist —
// run that SQL block in the Supabase SQL editor first (this repo has no
// migrations CLI; schema changes are applied there by hand).
//
// Run with: ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/create-admin-user.ts
// To reset an EXISTING user's password: also set ADMIN_RESET_PASSWORD=true

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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_RESET_PASSWORD = process.env.ADMIN_RESET_PASSWORD === "true";

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Error: ADMIN_EMAIL and ADMIN_PASSWORD must both be set (no hardcoded default — see this file's header comment).");
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 10) {
  console.error("Error: ADMIN_PASSWORD must be at least 10 characters (matches this app's own password policy, lib/password-policy.ts).");
  process.exit(1);
}

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
  // Non-null: validated at module load above (process.exit(1) if absent) —
  // TS can't see across that check into this function body on its own.
  const existing = await findUserByEmail(ADMIN_EMAIL!);

  if (existing) {
    // Security audit fix — password is now ONLY touched with explicit
    // opt-in (ADMIN_RESET_PASSWORD=true), and doing so always re-flags
    // must_change_password:true so a reset-to-a-known-value password is
    // never left silently in place with no forced re-change prompt.
    if (ADMIN_RESET_PASSWORD) {
      console.log(`User ${ADMIN_EMAIL} already exists (${existing.id}) — ADMIN_RESET_PASSWORD=true, resetting password and re-flagging must_change_password.`);
      const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
        password: ADMIN_PASSWORD,
        email_confirm: true,
      });
      if (updateErr) throw updateErr;
    } else {
      console.log(`User ${ADMIN_EMAIL} already exists (${existing.id}) — leaving password untouched (set ADMIN_RESET_PASSWORD=true to reset it).`);
    }

    // Ensure a profile row exists. must_change_password is only force-set
    // to true when the password was actually just reset above — otherwise
    // an existing profile's flag (the user's own choice, whether they've
    // already changed their bootstrap password) is left untouched.
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
      const profileUpdate: Record<string, any> = { email: ADMIN_EMAIL, role: "ADMIN" };
      if (ADMIN_RESET_PASSWORD) profileUpdate.must_change_password = true;
      const { error: profileErr } = await supabase.from("profiles").update(profileUpdate).eq("id", existing.id);
      if (profileErr) throw profileErr;
    }

    console.log("Done.");
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
