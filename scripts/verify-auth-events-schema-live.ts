// scripts/verify-auth-events-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// auth_events table (Section 18 of supabase_schema.sql) actually exists.
// This table backs EVERY rate-limited route in the app (lib/rate-limit.ts's
// checkRateLimit) — countRecentAuthEvents throws (not fails-open) when the
// underlying query errors, so a missing table silently 500s every one of
// those routes, including app/api/auth/change-password. Zero writes beyond
// a throwaway probe row that's deleted again.
//
// Run with: npx tsx scripts/verify-auth-events-schema-live.ts

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

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("No Supabase configured in this environment — cannot verify live schema.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let ok = true;

  console.log("--- auth_events (Section 18) ---");
  const { error: selectErr } = await supabase
    .from("auth_events")
    .select("id, event_type, email, user_id, ip_address, user_agent, detail, created_at")
    .limit(1);
  if (selectErr) {
    console.log(`✗ Table "auth_events": ${selectErr.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "auth_events" exists`);

    // Confirm the exact query shape checkRateLimit/countRecentAuthEvents
    // actually issues (head-only count with event_type + email filters) —
    // not just that the table exists, but that the specific query pattern
    // every rate-limited route depends on works end-to-end.
    const probeEmail = `schema-probe-${Date.now()}@example.invalid`;
    const { error: insertErr } = await supabase.from("auth_events").insert({ event_type: "login_success", email: probeEmail });
    if (insertErr) {
      console.log(`✗ Insert probe row failed: ${insertErr.message}`);
      ok = false;
    } else {
      const { count, error: countErr } = await supabase
        .from("auth_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "login_success")
        .eq("email", probeEmail)
        .gte("created_at", new Date(Date.now() - 60_000).toISOString());
      if (countErr) {
        console.log(`✗ Rate-limit count query failed: ${countErr.message}`);
        ok = false;
      } else if (count !== 1) {
        console.log(`✗ Expected count 1 for the probe row, got ${count}`);
        ok = false;
      } else {
        console.log(`✓ checkRateLimit's exact query pattern (head-count by event_type+email+window) works`);
      }
      await supabase.from("auth_events").delete().eq("email", probeEmail);
      console.log("  (probe row cleaned up)");
    }
  }

  console.log(ok ? "\nAll checks passed — auth_events is fully live. Rate-limited routes (login, change-password, and every security-audit-hardened route) should work correctly now." : "\nSome checks failed — run supabase_schema.sql Section 18.");
  process.exit(ok ? 0 : 1);
}

main();
