// scripts/promote-all-users-to-admin.ts
// One-off (run by hand, not part of the normal dev loop — same category as
// scripts/backfill-*.ts). Sets every existing profiles row's role to ADMIN
// (OWNER rows are left alone — lib/auth.ts's isAdminRole treats OWNER and
// ADMIN identically, so there's nothing to gain by touching them).
//
// Requested explicitly: every account should be able to fully use the app
// as an admin. Real consequence, called out before running this — ADMIN/
// OWNER accounts all share ONE identity in this codebase (lib/auth.ts:88-102,
// userId/orgId pinned to "dev_user_id"/"dev_org_id"), unlike MEMBER/VIEWER
// which each get their own real user.id. So this does not just grant
// permissions — it merges every promoted account onto the shared identity:
// any project/analysis/report data that account created while it was
// MEMBER/VIEWER (filed under its own real user.id) stops being reachable
// through the app, though it isn't deleted. This is an intentional,
// confirmed tradeoff, not a bug.
//
// Does not touch must_change_password — orthogonal to role.
//
// Run with: npx tsx scripts/promote-all-users-to-admin.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import path from "path";

const envPath = path.resolve(__dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  console.log("Loaded .env.local\n");
}

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot run against the live project.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: profiles, error } = await supabase.from("profiles").select("id, email, role").order("email");
  if (error) throw error;
  if (!profiles || profiles.length === 0) {
    console.log("No profiles found — nothing to do.");
    process.exit(0);
  }

  console.log(`=== Promoting all non-admin accounts to ADMIN (${profiles.length} total profiles) ===\n`);

  let promoted = 0;
  let alreadyAdmin = 0;

  for (const p of profiles) {
    if (p.role === "OWNER" || p.role === "ADMIN") {
      console.log(`  - ${p.email}: already ${p.role} — skipping.`);
      alreadyAdmin++;
      continue;
    }
    const { error: updateErr } = await supabase.from("profiles").update({ role: "ADMIN" }).eq("id", p.id);
    if (updateErr) {
      console.error(`  x ${p.email}: FAILED — ${updateErr.message}`);
      continue;
    }
    console.log(`  + ${p.email}: ${p.role} -> ADMIN`);
    promoted++;
  }

  console.log(`\n=== Done: ${promoted} promoted, ${alreadyAdmin} already admin, ${profiles.length} total. ===`);
  process.exit(0);
}

main().catch(err => {
  console.error("promote-all-users-to-admin script failed:", err);
  process.exit(1);
});
