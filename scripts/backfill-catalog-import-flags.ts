// scripts/backfill-catalog-import-flags.ts
// ONE-TIME backfill — clears stale import_flags (incomplete/motor_needs_
// confirmation/heat_tech_needs_confirmation/tool_type_needs_review/
// tool_type_inferred_from_product) that no longer apply against a
// product's CURRENT field values, using the exact same lib/catalog-
// import.ts#isCatalogRowIncomplete logic the admin edit route now runs on
// every save. Fixes rows that were flagged at import time and have since
// been fully filled in via the admin UI but never re-saved through the
// (now-fixed) route, so the stale flag never cleared (e.g. "Xceed Dryer
// showing Incomplete with all columns filled").
//
// Deliberately REMOVAL-ONLY: never adds a flag a row didn't already carry,
// even if this recompute would now consider it warranted (some existing
// rows' flags were set by an older code path/one-off script this recompute
// doesn't fully reproduce — only asserting a flag is confirmed no longer
// necessary is safe to automate; asserting a NEW one is needed is not).
// Any flag type this recompute doesn't know about (e.g. a one-off script's
// "preorder_not_yet_shipping") is preserved untouched either way.
// Read-only report by default; pass --apply to actually write.
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

const APPLY = process.argv.includes("--apply");
const RECOMPUTED_FLAG_TYPES = new Set(["incomplete", "tool_type_needs_review", "tool_type_inferred_from_product", "motor_needs_confirmation", "heat_tech_needs_confirmation"]);

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  const { isCatalogRowIncomplete } = await import("../lib/catalog-import");

  const { data: products, error: prodErr } = await supabase.from("catalog_products").select("*");
  if (prodErr) throw prodErr;
  const { data: toolTypes, error: ttErr } = await supabase.from("tool_types").select("*");
  if (ttErr) throw ttErr;

  console.log(`Checking ${products?.length || 0} catalog products against ${toolTypes?.length || 0} tool types...`);
  console.log(APPLY ? "Mode: APPLY (will write changes)\n" : "Mode: DRY RUN (pass --apply to write)\n");

  let changed = 0;
  for (const p of products || []) {
    const current: string[] = p.import_flags || [];
    if (current.length === 0) continue; // nothing to possibly clear

    const primaryCriterion = toolTypes?.find((t: any) => t.type_key === p.tool_type)?.primary_criterion ?? null;
    const stillWarranted = (flag: string): boolean => {
      if (flag === "tool_type_needs_review") return !p.tool_type;
      if (flag === "tool_type_inferred_from_product") return true; // no recompute basis — never auto-clear
      if (flag === "motor_needs_confirmation") return primaryCriterion === "motor" && !p.motor_family;
      if (flag === "heat_tech_needs_confirmation") return primaryCriterion === "heat_technology" && !p.heat_tech_family;
      if (flag === "incomplete") {
        return isCatalogRowIncomplete(
          { targetPrice: p.target_price, description: p.description, toolType: p.tool_type, motorFamily: p.motor_family, heatTechFamily: p.heat_tech_family },
          (toolTypes || []) as any
        );
      }
      return true; // unrecognized flag type — never touched
    };

    const kept = current.filter(f => !RECOMPUTED_FLAG_TYPES.has(f) || stillWarranted(f));
    if (kept.length !== current.length) {
      changed++;
      const dropped = current.filter(f => !kept.includes(f));
      console.log(`  ${p.name}: dropping [${dropped.join(", ")}] -> remaining [${kept.join(", ") || "(none)"}]`);
      if (APPLY) {
        const { error } = await supabase.from("catalog_products").update({ import_flags: kept }).eq("id", p.id);
        if (error) console.error(`    ERROR updating ${p.name}: ${error.message}`);
      }
    }
  }

  console.log(`\n${changed} product(s) ${APPLY ? "updated" : "would be updated"}.`);
}
main().catch(e => { console.error(e); process.exit(1); });
