// scripts/test-signin-directly.ts
// One-off — attempts a real signInWithPassword against the live Supabase
// project using the ANON key (exactly the same call app/api/auth/login/
// route.ts and the change-password route's own re-verification step make),
// to confirm whether a specific email/password combo is genuinely valid at
// the Supabase Auth level, independent of this app's own routes/UI.
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

const EMAIL = "andreap@stylecraftus.com";
const PASSWORD = "Andrea2026Temp";

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) {
    console.log(`SIGN-IN FAILED: ${error.message} (status ${(error as any).status}, code ${(error as any).code})`);
    process.exit(1);
  }
  console.log(`SIGN-IN SUCCEEDED for ${EMAIL} — user id ${data.user?.id}, session present: ${!!data.session}`);
  // Immediately sign out this test session so it doesn't linger as an
  // extra active session for the real account.
  await supabase.auth.signOut();
}

main();
