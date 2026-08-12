// scripts/reset-single-user-password.ts
// One-off, targeted password reset for exactly ONE existing user by email —
// unlike scripts/create-team-users.ts (whose TEAM_RESET_PASSWORD=true resets
// EVERY email in its TEAM_EMAILS array, a real gotcha discovered this
// session), this touches only the one account named below. Always
// re-flags must_change_password so the reset temp password is never left
// in place without a forced re-change prompt.
//
// Run with: npx tsx scripts/reset-single-user-password.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

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

const TARGET_EMAIL = "andreap@stylecraftus.com";
const NEW_TEMP_PASSWORD = "Andrea2026Temp";

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (NEW_TEMP_PASSWORD.length < 10) {
    console.error("NEW_TEMP_PASSWORD must be at least 10 characters (matches lib/password-policy.ts).");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  let page = 1;
  let match: any = null;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    match = data.users.find(u => u.email?.toLowerCase() === TARGET_EMAIL);
    if (match || data.users.length < 1000) break;
    page++;
  }
  if (!match) {
    console.error(`No user found for ${TARGET_EMAIL}`);
    process.exit(1);
  }

  const { error: updateErr } = await supabase.auth.admin.updateUserById(match.id, { password: NEW_TEMP_PASSWORD, email_confirm: true });
  if (updateErr) throw updateErr;

  const { error: profileErr } = await supabase.from("profiles").update({ must_change_password: true, updated_at: new Date().toISOString() }).eq("id", match.id);
  if (profileErr) throw profileErr;

  console.log(`Password reset for ${TARGET_EMAIL} (${match.id}). New temporary password: ${NEW_TEMP_PASSWORD}`);
  console.log("must_change_password re-flagged true — forced change on next login.");
}

main();
