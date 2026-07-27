// scripts/create-team-users.ts
// Creates (or safely re-runs against) real Supabase Auth accounts for team
// members, each getting their own genuinely isolated workspace — role
// "MEMBER" (not ADMIN/OWNER), so lib/auth.ts's getAuthSession() gives them
// their OWN real user.id as both userId/orgId (see the "isAdminRole" branch
// there), instead of the fixed pinned literal the seeded admin account
// uses. That's what makes each account's projects/analyses/reports/
// competitors genuinely separate from every other account's — the
// query-layer filtering already existed, it just needed real distinct ids
// to filter by.
//
// Idempotent, mirrors scripts/create-admin-user.ts exactly: re-running
// resets the password but never overwrites an existing must_change_password
// flag once the person has changed it themselves.
//
// Run with: npx tsx scripts/create-team-users.ts

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
  console.log("Loaded .env.local\n");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, "");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env or .env.local");
  process.exit(1);
}

const TEMP_PASSWORD = "123456789";

const TEAM_EMAILS = [
  "support@stylecraftus.com",
  "austin@stylecraftus.com",
  "peterg@stylecraftus.com",
  "rafap@stylecraftus.com",
  "leolal@stylecraftus.com",
];

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

const supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email: string) {
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

async function ensureUser(email: string) {
  const name = displayNameFromEmail(email);
  const existing = await findUserByEmail(email);

  if (existing) {
    console.log(`${email} already exists (${existing.id}) — resetting password, leaving must_change_password untouched.`);
    const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
      password: TEMP_PASSWORD,
      email_confirm: true,
    });
    if (updateErr) throw updateErr;

    const { data: profile } = await supabase.from("profiles").select("id").eq("id", existing.id).maybeSingle();
    if (!profile) {
      const { error: profileErr } = await supabase.from("profiles").insert({
        id: existing.id, email, name, role: "MEMBER", must_change_password: true,
      });
      if (profileErr) throw profileErr;
      console.log(`  Created missing profile row for ${email}.`);
    } else {
      const { error: profileErr } = await supabase.from("profiles").update({ email, name, role: "MEMBER" }).eq("id", existing.id);
      if (profileErr) throw profileErr;
    }
    return;
  }

  console.log(`Creating ${email}…`);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email, password: TEMP_PASSWORD, email_confirm: true,
  });
  if (createErr) throw createErr;

  const { error: profileErr } = await supabase.from("profiles").insert({
    id: created.user.id, email, name, role: "MEMBER", must_change_password: true,
  });
  if (profileErr) throw profileErr;

  console.log(`  Created ${email} (${created.user.id}) — role MEMBER, must change password on first login.`);
}

async function main() {
  for (const email of TEAM_EMAILS) {
    await ensureUser(email);
  }
  console.log(`\nDone — ${TEAM_EMAILS.length} team accounts ready. Temporary password for all: ${TEMP_PASSWORD} (forced change on first login).`);
}

main().catch(err => {
  console.error("create-team-users script failed:", err.message || err);
  process.exit(1);
});
