// scripts/verify-deck-signed-upload.ts
// Confirms the real fix for the "unexpected token" upload error: a signed
// Storage upload URL round-trips correctly against the REAL production
// Supabase project (createSignedUploadUrl -> uploadToSignedUrl with the
// anon-key client, exactly as the browser does -> download -> compare
// bytes), then deletes the test object. No AI/Rainforest calls — this is
// pure Supabase Storage I/O against a small, disposable test buffer.
//
// Run with: npx tsx scripts/verify-deck-signed-upload.ts

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
  console.warn("Warning: Could not read .env.local file.");
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    console.log("Supabase not configured in this environment — cannot verify.");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey);
  const anon = createClient(url, anonKey); // same client the browser uses

  const path = `verify-test-${Date.now()}.bin`;
  const testBytes = Buffer.from("deck-signed-upload-verification-payload");

  console.log(`[1] Server-side: createSignedUploadUrl("${path}")`);
  const { data: signed, error: signError } = await admin.storage.from("deck-templates").createSignedUploadUrl(path);
  if (signError || !signed) {
    console.error("FAIL:", signError?.message);
    process.exit(1);
  }
  console.log(`  PASS: got signed token (path=${signed.path})`);

  console.log("[2] Client-side (anon key, same as browser): uploadToSignedUrl(...)");
  const { error: uploadError } = await anon.storage.from("deck-templates").uploadToSignedUrl(signed.path, signed.token, testBytes);
  if (uploadError) {
    console.error("FAIL:", uploadError.message);
    process.exit(1);
  }
  console.log("  PASS: uploaded via signed URL with the anon-key client");

  console.log("[3] Server-side: download the bytes back and compare");
  const { data: downloaded, error: downloadError } = await admin.storage.from("deck-templates").download(signed.path);
  if (downloadError || !downloaded) {
    console.error("FAIL:", downloadError?.message);
    process.exit(1);
  }
  const downloadedBuffer = Buffer.from(await downloaded.arrayBuffer());
  const matches = downloadedBuffer.equals(testBytes);
  console.log(matches ? "  PASS: downloaded bytes match exactly what was uploaded" : "  FAIL: byte mismatch");

  console.log("[4] Cleanup: removing test object");
  const { error: removeError } = await admin.storage.from("deck-templates").remove([signed.path]);
  console.log(removeError ? `  WARN: cleanup failed (${removeError.message}) — remove "${signed.path}" manually` : "  PASS: test object removed");

  console.log(matches && !uploadError ? "\nAll checks passed — the signed-upload-URL fix works against real production Supabase." : "\nSome checks failed.");
  process.exit(matches ? 0 : 1);
}

main();
