// scripts/clear-rate-limit.ts
// One-off — deletes recent auth_events rows for one (userId, eventType)
// pair to immediately unblock a legitimate rate-limit lockout, rather than
// waiting out the window. checkRateLimit (lib/rate-limit.ts) only ever
// COUNTS rows in a rolling window — deleting them is the only way to reset
// it early; there's no separate mutable counter to just zero out.
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

const TARGET_USER_ID = "e650fcc4-5b9e-46aa-920d-1e3234a02a29"; // andreap@stylecraftus.com
const EVENT_TYPE = "change_password_verify";

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("auth_events")
    .delete()
    .eq("event_type", EVENT_TYPE)
    .eq("user_id", TARGET_USER_ID)
    .select("id");
  if (error) throw error;

  console.log(`Cleared ${data?.length ?? 0} "${EVENT_TYPE}" rate-limit rows for user ${TARGET_USER_ID}.`);
}

main();
