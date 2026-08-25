import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
const envPath = resolve(process.cwd(), ".env.local");
readFileSync(envPath, "utf-8").split("\n").forEach(line => {
  const t = line.trim();
  if (!t || t.startsWith("#")) return;
  const i = t.indexOf("=");
  if (i === -1) return;
  const k = t.substring(0, i).trim();
  let v = t.substring(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k] = v;
});
async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  for (const table of ["projects", "analyses", "reports"]) {
    const { data, error } = await supabase.from(table).select("id, org_id, user_id, created_at").order("created_at", { ascending: false });
    if (error) { console.log(table, "error:", error.message); continue; }
    console.log(`\n=== ${table} (${data?.length || 0} rows) ===`);
    const byOrg: Record<string, number> = {};
    for (const row of data || []) byOrg[row.org_id] = (byOrg[row.org_id] || 0) + 1;
    console.log("org_id distribution:", JSON.stringify(byOrg, null, 2));
    // show a few non-dev_org_id rows if any
    const orphaned = (data || []).filter(r => r.org_id !== "dev_org_id");
    if (orphaned.length > 0) {
      console.log(`${orphaned.length} row(s) NOT under dev_org_id:`);
      for (const r of orphaned.slice(0, 10)) console.log(`  id=${r.id} org_id=${r.org_id} user_id=${r.user_id} created_at=${r.created_at}`);
    }
  }

  // Map org_id/user_id (real UUIDs) back to emails for readability
  const { data: profiles } = await supabase.from("profiles").select("id, email, role");
  console.log("\nprofiles:", JSON.stringify(profiles, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
