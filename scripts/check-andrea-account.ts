// scripts/check-andrea-account.ts
// One-off, read-only diagnostic pattern for a single login-issue report
// (originally andreap@stylecraftus.com) — not part of the normal dev loop.
// Checks the real Supabase Auth user + profiles row state. Zero writes.
// Edit TARGET_EMAIL to reuse for a different account's login report.
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

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
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
    console.log(`No Supabase Auth user found for ${TARGET_EMAIL} at all.`);
    process.exit(0);
  }

  console.log("Auth user found:");
  console.log("  id:", match.id);
  console.log("  email:", match.email);
  console.log("  email_confirmed_at:", match.email_confirmed_at);
  console.log("  confirmed_at:", match.confirmed_at);
  console.log("  created_at:", match.created_at);
  console.log("  last_sign_in_at:", match.last_sign_in_at);
  console.log("  banned_until:", match.banned_until ?? null);
  console.log("  app_metadata:", JSON.stringify(match.app_metadata));

  const { data: profile, error: profErr } = await supabase.from("profiles").select("*").eq("id", match.id).maybeSingle();
  if (profErr) throw profErr;
  console.log("\nProfile row:", profile ? JSON.stringify(profile, null, 2) : "MISSING");

  const { data: events, error: eventsErr } = await supabase
    .from("auth_events")
    .select("event_type, detail, created_at")
    .or(`email.eq.${TARGET_EMAIL},user_id.eq.${match.id}`)
    .order("created_at", { ascending: false })
    .limit(30);
  if (eventsErr) {
    console.log("\nauth_events query error:", eventsErr.message);
  } else {
    console.log("\nRecent auth_events:");
    for (const row of events || []) console.log(" ", row.created_at, row.event_type, row.detail ? `(${row.detail})` : "");
    if (!events?.length) console.log("  (none)");
  }
}

main();
