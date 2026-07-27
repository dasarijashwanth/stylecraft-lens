// scripts/verify-support-schema-live.ts
// Read-only sanity check against the REAL Supabase project: confirms the
// support_messages table and the "support-screenshots" Storage bucket exist
// after the user manually runs the updated supabase_schema.sql and creates
// the bucket. Zero writes, zero AI/Rainforest calls — just SELECT/list.
//
// Run with: npx tsx scripts/verify-support-schema-live.ts

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

  const { error, count } = await supabase.from("support_messages").select("id", { count: "exact", head: true });
  if (error) {
    console.log(`✗ Table "support_messages": ${error.message}`);
    ok = false;
  } else {
    console.log(`✓ Table "support_messages" exists (${count ?? 0} row(s))`);
  }

  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    console.log(`✗ Could not list Storage buckets: ${bucketErr.message}`);
    ok = false;
  } else {
    const found = buckets?.some(b => b.name === "support-screenshots");
    console.log(found ? `✓ Storage bucket "support-screenshots" exists` : `✗ Storage bucket "support-screenshots" NOT found (create it manually — Public bucket — in the Supabase dashboard)`);
    if (!found) ok = false;
  }

  const { error: colErr } = await supabase.from("support_messages").select("email_status, ack_email_status, admin_notification_read").limit(1);
  if (colErr) {
    console.log(`✗ support_messages status columns: ${colErr.message}`);
    ok = false;
  } else {
    console.log(`✓ support_messages status columns exist`);
  }

  console.log(ok ? "\nAll checks passed — Contact Support is fully live." : "\nSome checks failed — see above.");
  process.exit(ok ? 0 : 1);
}

main();
