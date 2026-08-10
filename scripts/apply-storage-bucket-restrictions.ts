// scripts/apply-storage-bucket-restrictions.ts
// Security audit fix — Storage buckets aren't SQL objects (same "created
// manually" precedent as bucket creation itself, see supabase_schema.sql's
// own comments), so their content-type/size restrictions can't live in
// supabase_schema.sql either. This is a ONE-OFF maintenance script (same
// category as create-admin-user.ts) that applies real, Storage-service-
// enforced `allowedMimeTypes`/`fileSizeLimit` settings — the only actual
// fix for the finding that a signed-upload-URL's declared contentType/
// fileSize (checked by app code at URL-issuance time) is never bound to
// the real PUT: Supabase's Storage service itself rejects the upload if
// the real bytes' detected type doesn't match, regardless of what the app
// declared when minting the signed URL, and regardless of whether any
// app-level "finalize" step ever runs afterward.
//
// Idempotent — safe to re-run. Requires SUPABASE_SERVICE_ROLE_KEY (loads
// .env.local directly, bypasses this repo's @/ module system, same
// convention as every other scripts/*.ts maintenance script).
//
// Run with: npx tsx scripts/apply-storage-bucket-restrictions.ts

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

// Only buckets that hold end-user-uploaded binary content need this — pure
// admin/internal-tool buckets (deck-templates, gtm-workbook-templates,
// project-source-docs) are already private and app-validated by magic
// bytes before ever reaching Storage (lib/file-magic-bytes.ts /
// lib/tds-doc-extract.ts), so a Storage-level restriction is redundant
// defense-in-depth there rather than the primary fix — applied anyway
// since it's free and strictly safer.
const BUCKET_RESTRICTIONS: { id: string; allowedMimeTypes: string[]; fileSizeLimitBytes: number }[] = [
  // Public bucket, any signed-in user can mint an upload slot — this is
  // the actual finding: without this, an attacker could PUT an .html file
  // and have Supabase serve it back as text/html from a public URL.
  { id: "support-screenshots", allowedMimeTypes: ["image/png", "image/jpeg"], fileSizeLimitBytes: 5 * 1024 * 1024 },
  // Public bucket, project-owner-only writes, already magic-byte-validated
  // server-side before upload (app/api/projects/[id]/artwork/route.ts) —
  // belt-and-suspenders.
  { id: "artwork", allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"], fileSizeLimitBytes: 10 * 1024 * 1024 },
  // Private, admin-only, already magic-byte-validated pre-parse — belt-
  // and-suspenders against a non-.xlsx zip being accepted at all.
  { id: "gtm-workbook-templates", allowedMimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], fileSizeLimitBytes: 50 * 1024 * 1024 },
  { id: "deck-templates", allowedMimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], fileSizeLimitBytes: 50 * 1024 * 1024 },
];

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot apply live Storage settings.");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  let failures = 0;
  for (const b of BUCKET_RESTRICTIONS) {
    const { data: existing, error: getError } = await supabase.storage.getBucket(b.id);
    if (getError || !existing) {
      console.error(`✗ Bucket "${b.id}" not found (${getError?.message || "no data"}) — skipping. Create it manually first if it should exist.`);
      failures++;
      continue;
    }
    const { error: updateError } = await supabase.storage.updateBucket(b.id, {
      public: existing.public,
      fileSizeLimit: b.fileSizeLimitBytes,
      allowedMimeTypes: b.allowedMimeTypes,
    });
    if (updateError) {
      console.error(`✗ Failed to restrict bucket "${b.id}": ${updateError.message}`);
      failures++;
    } else {
      console.log(`✓ Bucket "${b.id}" restricted to [${b.allowedMimeTypes.join(", ")}], max ${(b.fileSizeLimitBytes / 1024 / 1024).toFixed(0)}MB`);
    }
  }

  console.log(failures > 0 ? "\nSome buckets failed — see above." : "\nAll buckets restricted successfully.");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
