// scripts/backfill-amazon-fields.ts
// Opt-in backfill: re-fetches Amazon product data for existing projects so
// they gain the widened field set (description, manufacturer, model_number,
// specifications, top_reviews, rating_breakdown, etc. — see
// lib/rainforest.ts) that a pre-widening capture never stored.
//
// IMPORTANT — real cost warning: neither amazon_cache.payload nor
// product_snapshots.raw_data.amazon ever stored Rainforest's raw JSON, only
// the narrower, already-mapped object. There is no free way to recover the
// new fields for a product captured before this change — this script makes
// one real, credit-costing Rainforest `type=product` call per unique ASIN.
// The account's Rainforest credits are limited — this NEVER runs
// automatically and NEVER makes a live call without an explicit --confirm.
//
// This does NOT regenerate TDS/GTM documents — it only refreshes the
// underlying snapshot/cache data. Re-derive documents afterward via the
// existing "re-capture snapshot" action or scripts/backfill-gtm.ts.
//
// Snapshots are append-only by convention (lib/db/snapshots.ts: "a snapshot
// is never overwritten: re-capturing inserts a new row") — this script
// respects that and inserts a new snapshot version rather than mutating the
// old row, exactly like the existing "re-capture snapshot" UI action does.
//
// Usage:
//   npx tsx scripts/backfill-amazon-fields.ts            # dry run — counts only, zero Rainforest calls
//   npx tsx scripts/backfill-amazon-fields.ts --confirm   # makes the real calls

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
  console.log("Successfully loaded environment variables from .env.local");
} catch (e) {
  console.warn("Warning: Could not read .env.local file. Proceeding with system env vars.");
}

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, "");
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env or .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Must be dynamic — lib/rainforest.ts (and lib/db/snapshots.ts through
// lib/supabase.ts) read process.env at module-load time. A plain top-level
// import would be hoisted ahead of the manual .env.local loading above.
async function loadModules() {
  const [rainforest, snapshots] = await Promise.all([
    import("../lib/rainforest"),
    import("../lib/db/snapshots"),
  ]);
  return { ...rainforest, ...snapshots };
}

const CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface Candidate {
  projectId: string;
  asin: string;
  snapshot: any; // SnapshotRow
}

async function main() {
  const { fetchAmazonProductFresh, insertSnapshot } = await loadModules();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, product_name");
  if (projectsError) throw projectsError;
  if (!projects || projects.length === 0) {
    console.log("No projects found.");
    return;
  }

  console.log(`Scanning ${projects.length} projects for snapshots missing the widened Amazon field set...`);

  const candidates: Candidate[] = [];
  const seenAsins = new Set<string>();

  for (const project of projects) {
    const { data: snapshots, error: snapError } = await supabase
      .from("product_snapshots")
      .select("*")
      .eq("project_id", project.id)
      .order("captured_at", { ascending: false })
      .limit(1);
    if (snapError) { console.warn(`Skipping ${project.id} — snapshot query failed:`, snapError.message); continue; }

    const snapshot = snapshots?.[0];
    const az = snapshot?.raw_data?.amazon;
    if (!az || !az.asin) continue; // no Amazon data captured for this project at all

    // Already has the widened fields (either captured after this change, or
    // already backfilled) — skip. `description` is a representative marker
    // field; a listing genuinely lacking a description is rare and, even if
    // skipped, costs nothing (it would just re-confirm null on a re-run).
    if (az.description !== undefined) continue;

    const asin = String(az.asin).toUpperCase();
    if (seenAsins.has(asin)) continue;
    seenAsins.add(asin);
    candidates.push({ projectId: project.id, asin, snapshot });
  }

  console.log(`\n${candidates.length} project(s) with a captured Amazon listing that would gain new fields.`);
  console.log(`This will make ${candidates.length} live Rainforest "type=product" call(s) — each costs a credit, and the account's credits are limited.`);

  const confirmed = process.argv.includes("--confirm") || process.env.BACKFILL_CONFIRM === "1";
  if (!confirmed) {
    console.log("\nDry run only — no Rainforest calls made. Re-run with --confirm (or BACKFILL_CONFIRM=1) to proceed.");
    return;
  }
  if (candidates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\n--confirm passed — proceeding with live calls...\n");

  let gainedAny = 0;
  let noNewData = 0;
  let failed = 0;

  await mapWithConcurrency(candidates, CONCURRENCY, async (c) => {
    try {
      const fresh = await fetchAmazonProductFresh(c.asin);
      if (!fresh) {
        failed++;
        console.log(`✗ ${c.asin} — Rainforest fetch failed (see console.warn logs above for detail)`);
        return;
      }

      const gains = {
        description: !!fresh.description,
        manufacturer: !!fresh.manufacturer,
        model_number: !!fresh.model_number,
        specifications: fresh.specifications.length > 0,
        top_reviews: fresh.top_reviews.length > 0,
        rating_breakdown: !!fresh.rating_breakdown,
      };
      const gainedCount = Object.values(gains).filter(Boolean).length;
      if (gainedCount === 0) noNewData++; else gainedAny++;

      // New snapshot version — preserves the existing site-scrape half,
      // never mutates the prior row (matches the "re-capture snapshot"
      // convention already used elsewhere).
      await insertSnapshot({
        projectId: c.projectId,
        sourceUrl: c.snapshot.source_url ?? null,
        asin: c.asin,
        rawData: { ...c.snapshot.raw_data, amazon: fresh },
      });

      console.log(`✓ ${c.asin} — gained: ${Object.entries(gains).map(([k, v]) => `${k}=${v ? "yes" : "no"}`).join(", ")}`);
    } catch (err: any) {
      failed++;
      console.log(`✗ ${c.asin} — threw: ${err.message || err}`);
    }
  });

  console.log(`\nDone. ${gainedAny} gained new data, ${noNewData} had nothing new, ${failed} failed.`);
  console.log("Reminder: this only refreshed source snapshots. Run the project's \"re-capture snapshot\" action (or scripts/backfill-gtm.ts) to regenerate TDS/GTM documents from the new data.");
}

main().catch(err => {
  console.error("Backfill script failed:", err);
  process.exit(1);
});
